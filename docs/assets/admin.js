/* Рабочее место ответственного: вход, разделы, действия. Данные — в таблице офиса (через шлюз Api.gs). */
(function () {
  const { offices, call, store, el, fmtDate, fmtDay, plural, norm } = window.TMC;
  const $ = id => document.getElementById(id);
  const SESSION_KEY = 'tmc_session';
  let session = store.get(SESSION_KEY);
  let meta = null, catalogCache = null;

  // ---------- Связь ----------

  async function api(action, body) {
    try {
      return await call(session.officeId, action, Object.assign({ token: session.token }, body || {}));
    } catch (e) {
      if (e.auth) { logout(e.message); throw new Error(e.message); }
      throw e;
    }
  }
  window.TMC.api = (a, b) => api(a, b);

  let toastTimer;
  function toast(text, bad) {
    let t = document.querySelector('.toast');
    if (!t) { t = el('div', { class: 'toast', role: 'status' }); document.body.append(t); }
    t.textContent = text;
    t.className = 'toast' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), bad ? 7000 : 4000);
  }
  window.TMC.toast = toast;

  // ---------- Вход ----------

  function showLogin(msg) {
    $('appView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
    $('loginOffice').replaceChildren(...offices.map(o => el('option', { value: o.id, text: o.name })));
    $('loginOfficeWrap').classList.toggle('hidden', offices.length < 2);
    const last = store.get('tmc_last') || {};
    if (last.officeId && TMC.office(last.officeId)) $('loginOffice').value = last.officeId;
    if (last.name) $('loginName').value = last.name;
    $('loginErr').textContent = msg || '';
    (last.name ? $('loginPass') : $('loginName')).focus();
  }

  $('loginForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const officeId = $('loginOffice').value || (offices[0] && offices[0].id);
    const name = $('loginName').value.trim();
    if (!name) { $('loginErr').textContent = 'Укажите своё имя — оно попадёт в журнал операций.'; return; }
    $('loginBtn').disabled = true; $('loginErr').textContent = '';
    try {
      const res = await call(officeId, 'login', { password: $('loginPass').value, name });
      session = { officeId, token: res.token, name: res.name, office: res.office };
      store.set(SESSION_KEY, session);
      store.set('tmc_last', { officeId, name });
      $('loginPass').value = '';
      startApp();
    } catch (e) {
      $('loginErr').textContent = e.message;
    } finally { $('loginBtn').disabled = false; }
  });

  function logout(msg) {
    store.del(SESSION_KEY);
    session = null; meta = null; catalogCache = null;
    showLogin(msg);
  }
  $('logout').addEventListener('click', () => logout());
  $('switchOffice').addEventListener('click', () => logout());

  async function startApp() {
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    const o = TMC.office(session.officeId);
    $('barOffice').textContent = session.office || (o && o.name) || '';
    $('barUser').textContent = session.name;
    $('switchOffice').classList.toggle('hidden', offices.length < 2);
    route();
    try { meta = await api('meta'); } catch (e) { /* покажется в разделе */ }
  }

  // ---------- Разделы ----------

  const VIEWS = { overview, requests, stock, issued, furniture, journal, import: importView, team };

  function route() {
    if (!session) return;
    const name = (location.hash || '#overview').slice(1);
    const view = VIEWS[name] ? name : 'overview';
    document.querySelectorAll('#tabs button').forEach(b => {
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const main = $('main');
    main.replaceChildren(el('div', { class: 'loading', text: 'Загружаю…' }));
    VIEWS[view](main).catch(e => main.replaceChildren(el('div', { class: 'note bad', text: e.message })));
  }
  window.addEventListener('hashchange', route);
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-view]');
    if (b) location.hash = b.dataset.view;
  });

  function head(title, sub, ...right) {
    return el('div', { class: 'view-head' },
      el('div', {}, el('h1', { text: title }), sub ? el('p', { class: 'muted', text: sub }) : null),
      right.length ? el('div', { class: 'toolbar', style: 'margin:0' }, ...right) : null);
  }
  const empty = text => el('div', { class: 'empty', text });
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  function setOpenCount(n) { $('openCount').textContent = n ? String(n) : ''; }

  // ---------- Сводка ----------

  async function overview(main) {
    const d = await api('overview');
    setOpenCount(d.open.length);
    const fig = (n, label, alert) => el('div', { class: 'figure' + (alert && n ? ' alert' : '') }, el('b', { text: String(n) }), el('span', { text: label }));
    main.replaceChildren(
      head('Сводка', d.office),
      el('div', { class: 'figures' },
        fig(d.counts.new, 'новых ' + plural(d.counts.new, 'заявка', 'заявки', 'заявок')),
        fig(d.counts.work, 'в работе'),
        fig(d.counts.inStock, 'шт. на складе'),
        fig(d.counts.toBuy, 'пора докупить', true)),
      el('div', { class: 'two-col' },
        el('section', {}, el('h2', { text: 'Открытые заявки' }),
          d.open.length ? el('div', { class: 'reqs' }, ...d.open.map(reqCard)) : empty('Открытых заявок нет')),
        el('section', {}, el('h2', { text: 'Пора докупить' }),
          d.toBuy.length
            ? el('div', { class: 'table-wrap' }, el('table', {},
                el('thead', {}, el('tr', {}, el('th', { text: 'Позиция' }), el('th', { class: 'n', text: 'Доступно' }), el('th', { class: 'n', text: 'Минимум' }))),
                el('tbody', {}, ...d.toBuy.map(i => el('tr', {}, el('td', { text: i.name }),
                  el('td', { class: 'n' }, el('span', { class: 'tag low', text: String(i.available) })), el('td', { class: 'n', text: String(i.min) }))))))
            : empty('Всего хватает')))
    );
  }

  // ---------- Заявки ----------

  const STATUS_CLASS = { 'Новая': 'new', 'В работе': 'work', 'Выдана': 'done', 'Принята на склад': 'done', 'Отклонена': 'off' };

  function reqCard(r) {
    const cls = STATUS_CLASS[r.status] || 'off';
    const card = el('article', { class: 'req ' + cls });
    const where = ['этаж ' + r.floor, r.desk ? 'стол ' + r.desk : ''].filter(Boolean).join(', ');
    const what = r.action === 'Сдать'
      ? 'Сдаёт' + (r.reason ? ': ' + String(r.reason).toLowerCase() : '') + (r.newFormat ? ' → ' + r.newFormat : '')
      : 'Заказ' + (r.format ? ', ' + String(r.format).toLowerCase() + ' формат' : '');
    card.append(...[
      el('div', { class: 'req-head' },
        el('span', { class: 'tag', text: r.id }),
        el('span', { class: 'who', text: r.login }),
        el('span', { class: 'where', text: where }),
        el('span', { class: 'when', text: fmtDate(r.date, true) }),
        el('span', { class: 'status ' + cls, text: r.status })),
      el('div', { class: 'req-meta', text: what }),
      el('div', { class: 'req-items' }, ...r.items.map(n => el('span', { text: n }))),
      r.checks.length ? el('ul', { class: 'req-checks' }, ...r.checks.map(c => el('li', { text: c }))) : null,
      r.by ? el('div', { class: 'req-meta', text: 'Ответственный: ' + r.by + (r.rejectReason ? '. Причина отклонения: ' + r.rejectReason : '') }) : null
    ].filter(Boolean));
    const actions = el('div', { class: 'req-actions' });
    const doAct = async (act, btn, reason) => {
      actions.querySelectorAll('button,select').forEach(b => b.disabled = true);
      btn.textContent = 'Выполняю…';
      try {
        const res = await api('requestAction', { id: r.id, act, reason });
        toast(res.message);
        if (res.request) card.replaceWith(reqCard(res.request));
        refreshCount();
      } catch (e) {
        toast(e.message, true);
        card.replaceWith(reqCard(r));
      }
    };
    const showReject = () => {
      const sel = el('select', { 'aria-label': 'Причина отклонения' },
        ...((meta && meta.rejectReasons) || ['Нет в наличии', 'Другое']).map(x => el('option', { value: x, text: x })));
      const go = el('button', { class: 'btn danger small', type: 'button', text: 'Отклонить заявку' });
      go.addEventListener('click', () => doAct('reject', go, sel.value));
      actions.replaceChildren(sel, go, el('button', { class: 'link', type: 'button', text: 'Отмена', onclick: () => card.replaceWith(reqCard(r)) }));
    };
    const btn = (text, cls2, fn) => { const b = el('button', { class: 'btn small ' + cls2, type: 'button', text }); b.addEventListener('click', () => fn(b)); return b; };
    if (r.status === 'Новая') {
      actions.append(btn('Взять в работу', '', b => doAct('take', b)), btn('Отклонить', 'danger', showReject));
    } else if (r.status === 'В работе') {
      actions.append(r.action === 'Сдать'
        ? btn('Принято на склад', '', b => doAct('accept', b))
        : btn('Выдано', '', b => doAct('issue', b)), btn('Отклонить', 'danger', showReject));
    }
    if (actions.children.length) card.append(actions);
    return card;
  }

  async function refreshCount() {
    try { const list = await api('requests', { scope: 'open' }); setOpenCount(list.length); } catch (e) { /* не важно */ }
  }

  async function requests(main) {
    const scope = el('select', { 'aria-label': 'Какие заявки' },
      el('option', { value: 'open', text: 'Открытые' }), el('option', { value: 'all', text: 'Все (последние 300)' }));
    const q = el('input', { type: 'search', placeholder: 'Поиск: логин, №, позиция, стол' });
    const list = el('div', { class: 'reqs' });
    const load = async () => {
      list.replaceChildren(el('div', { class: 'loading', text: 'Загружаю…' }));
      try {
        const rows = await api('requests', { scope: scope.value, q: q.value });
        if (scope.value === 'open' && !q.value) setOpenCount(rows.length);
        list.replaceChildren(...(rows.length ? rows.map(reqCard) : [empty(scope.value === 'open' ? 'Открытых заявок нет' : 'Ничего не найдено')]));
      } catch (e) { list.replaceChildren(el('div', { class: 'note bad', text: e.message })); }
    };
    scope.addEventListener('change', load);
    q.addEventListener('input', debounce(load, 400));
    const formLink = el('a', { class: 'btn ghost', href: 'zayavka.html?office=' + encodeURIComponent(session.officeId), target: '_blank', text: 'Форма для сотрудников' });
    main.replaceChildren(head('Заявки', 'Новые сверху. Действия здесь и кнопки в Telegram — одно и то же.', formLink),
      el('div', { class: 'toolbar' }, scope, q), list);
    await load();
  }

  // ---------- Склад ----------

  async function loadCatalog() {
    catalogCache = await api('catalog');
    return catalogCache;
  }

  const NO_CAT = 'Без категории';
  const collapsed = new Set(store.get('tmc_collapsed') || []);

  async function stock(main) {
    const c = await loadCatalog();
    const q = el('input', { type: 'search', placeholder: 'Поиск по позиции или категории' });
    const box = el('div', { class: 'cat-groups' });
    const COLS = ['Позиция', 'Категория', 'Сотрудникам', 'Кому', 'Мин.', 'На складе', 'В работе', 'Доступно', ''];

    const render = () => {
      const w = norm(q.value);
      const items = c.items.filter(i => !w || norm(i.name + ' ' + i.category).indexOf(w) >= 0);
      // Порядок групп — как в списке категорий; пустые категории тоже показываем (кроме поиска)
      const names = c.categories.slice();
      items.forEach(i => { if (i.category && names.indexOf(i.category) < 0) names.push(i.category); });
      names.push(NO_CAT);
      const groups = names.map(n => ({ name: n, items: items.filter(i => (i.category || NO_CAT) === n) }))
        .filter(g => g.items.length || (!w && g.name !== NO_CAT));
      if (!groups.length) { box.replaceChildren(empty('Ничего не найдено')); return; }
      box.replaceChildren(...groups.map(g => catGroup(g, !!w)));
    };

    function catGroup(g, searching) {
      const open = searching || !collapsed.has(g.name);
      const isReal = g.name !== NO_CAT;
      const toggle = el('button', { class: 'cat-toggle', type: 'button', 'aria-expanded': String(open) },
        el('span', { class: 'chev', 'aria-hidden': 'true', text: '▸' }),
        el('h2', { text: g.name }),
        el('span', { class: 'muted small', text: g.items.length + ' ' + plural(g.items.length, 'позиция', 'позиции', 'позиций') }));
      const tools = el('div', { class: 'cat-tools' },
        el('button', { class: 'link', type: 'button', text: '+ Позиция', onclick: () => openNewItem(isReal ? g.name : '') }),
        isReal ? el('button', { class: 'link', type: 'button', text: 'Переименовать', onclick: () => renameCategory(g.name) }) : null,
        isReal ? el('button', { class: 'link danger-link', type: 'button', text: 'Удалить категорию', onclick: () => deleteCategory(g.name, g.items.length) }) : null);
      const table = el('div', { class: 'table-wrap' }, el('table', { class: 'stock' },
        el('thead', {}, el('tr', {}, ...COLS.map((h, i) => el('th', { class: i >= 4 && i <= 7 ? 'n' : '', text: h })))),
        el('tbody', {}, ...(g.items.length ? g.items.map(stockRow)
          : [el('tr', {}, el('td', { colspan: COLS.length, class: 'muted', text: 'В этой категории пока нет позиций.' }))]))));
      const sec = el('section', { class: 'cat-group' + (open ? '' : ' closed') }, el('div', { class: 'cat-head' }, toggle, tools), table);
      toggle.addEventListener('click', () => {
        const nowOpen = sec.classList.toggle('closed') === false;
        toggle.setAttribute('aria-expanded', String(nowOpen));
        if (nowOpen) collapsed.delete(g.name); else collapsed.add(g.name);
        store.set('tmc_collapsed', [...collapsed]);
      });
      return sec;
    }

    q.addEventListener('input', render);
    const opBtn = el('button', { class: 'btn', type: 'button', text: 'Операция со складом', onclick: () => openOp() });
    const addBtn = el('button', { class: 'btn ghost', type: 'button', text: '+ Новая позиция', onclick: () => openNewItem('') });
    const catBtn = el('button', { class: 'btn ghost', type: 'button', text: '+ Категория', onclick: () => newCategory() });
    const nameBtn = el('button', { class: 'btn ghost', type: 'button', text: 'Привести названия в порядок', onclick: () => openRename() });
    main.replaceChildren(
      head('Склад', c.items.length + ' ' + plural(c.items.length, 'позиция', 'позиции', 'позиций') + ' по категориям. Категорию, выдачу и минимум можно менять прямо в строке.', opBtn),
      el('div', { class: 'toolbar' }, q, addBtn, catBtn, nameBtn),
      box);
    render();
  }

  // ---------- Простое окно с полями (новая позиция, категория) ----------

  let formDlg = null;
  function formDialog({ title, fields, submit, onSubmit }) {
    if (!formDlg) { formDlg = el('dialog', { class: 'sheet' }); document.body.append(formDlg); }
    const inputs = {};
    const err = el('p', { class: 'err', role: 'alert' });
    const btn = el('button', { class: 'btn', type: 'submit', text: submit });
    const body = el('div', { class: 'sheet-body' }, ...fields.map(f => {
      if (f.type === 'check') {
        const x = el('input', { type: 'checkbox', checked: !!f.value });
        inputs[f.key] = x;
        return el('label', { class: 'check' }, x, el('span', { text: f.label }));
      }
      const x = f.type === 'select'
        ? el('select', {}, ...f.options.map(o => el('option', { value: o.value != null ? o.value : o, text: o.text != null ? o.text : o })))
        : el('input', { type: f.type || 'text', placeholder: f.placeholder || '' });
      if (f.value != null) x.value = f.value;
      inputs[f.key] = x;
      const wrap = el('label', { class: 'field' + (f.hidden ? ' hidden' : ''), 'data-key': f.key }, el('span', { text: f.label }), x);
      return wrap;
    }), err);
    const form = el('form', { class: 'sheet-form' },
      el('header', { class: 'sheet-head' }, el('h2', { text: title }), el('button', { class: 'link', type: 'button', text: 'Закрыть', onclick: () => formDlg.close() })),
      body, el('footer', { class: 'sheet-foot' }, btn));
    form.addEventListener('change', () => fields.forEach(f => {
      if (f.showIf) body.querySelector('[data-key="' + f.key + '"]').classList.toggle('hidden', !f.showIf(inputs));
    }));
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const v = {};
      Object.keys(inputs).forEach(k => { v[k] = inputs[k].type === 'checkbox' ? inputs[k].checked : inputs[k].value.trim(); });
      btn.disabled = true; err.textContent = '';
      try { await onSubmit(v); formDlg.close(); }
      catch (e) { err.textContent = e.message; }
      finally { btn.disabled = false; }
    });
    formDlg.replaceChildren(form);
    formDlg.showModal();
    form.dispatchEvent(new Event('change'));
    const first = body.querySelector('input,select'); if (first) first.focus();
  }

  async function reloadStock(msg) {
    if (msg) toast(msg);
    catalogCache = null;
    if (location.hash === '#stock') route();
  }

  function openNewItem(category) {
    const c = catalogCache;
    formDialog({
      title: 'Новая позиция', submit: 'Добавить позицию',
      fields: [
        { key: 'name', label: 'Название', placeholder: 'например, Настольная лампа' },
        { key: 'category', label: 'Категория', type: 'select', value: category || '',
          options: [{ value: '', text: NO_CAT }].concat(c.categories) },
        { key: 'forEmployees', label: 'Выдаётся сотрудникам по заявке', type: 'check', value: true },
        { key: 'audience', label: 'Кому выдаётся', type: 'select', options: c.audiences, showIf: i => i.forEmployees.checked },
        { key: 'min', label: 'Минимальный остаток (когда напомнить докупить)', type: 'number', value: '0' }
      ],
      onSubmit: async v => {
        if (!v.name) throw new Error('Введите название позиции.');
        const res = await api('addItem', { item: v });
        reloadStock(res.message + ' Чтобы поставить её на склад — «Операция со складом → Поступление».');
      }
    });
  }

  function newCategory() {
    formDialog({
      title: 'Новая категория', submit: 'Добавить категорию',
      fields: [{ key: 'name', label: 'Название', placeholder: 'например, Техника' }],
      onSubmit: async v => { const res = await api('addCategory', { name: v.name }); reloadStock(res.message); }
    });
  }

  function renameCategory(name) {
    formDialog({
      title: 'Переименовать категорию', submit: 'Сохранить',
      fields: [{ key: 'to', label: 'Новое название для «' + name + '»', value: name }],
      onSubmit: async v => {
        if (v.to === name) return;
        const res = await api('renameCategory', { from: name, to: v.to }); reloadStock(res.message);
      }
    });
  }

  async function deleteCategory(name, count) {
    const text = count
      ? 'Удалить категорию «' + name + '»? Её ' + count + ' ' + plural(count, 'позиция останется', 'позиции останутся', 'позиций останутся') + ' на складе, но без категории.'
      : 'Удалить пустую категорию «' + name + '»?';
    if (!confirm(text)) return;
    try { const res = await api('deleteCategory', { name }); reloadStock(res.message); }
    catch (e) { toast(e.message, true); }
  }

  async function deleteItem(i) {
    if (!confirm('Удалить позицию «' + i.name + '» со склада?')) return;
    try {
      let res = await api('deleteItem', { id: i.id });
      if (res.needConfirm) {
        const u = res.usage, parts = [];
        if (u.inStock) parts.push('на складе ' + u.inStock + ' шт. — они будут списаны');
        if (u.issuedTotal) parts.push('записей в «Выдано»: ' + u.issuedTotal + (u.issuedActive ? ' (числится за сотрудниками: ' + u.issuedActive + ')' : '') + ' — они удалятся');
        if (u.furniture) parts.push('в «Мебели по местам»: ' + u.furniture + ' шт. — строки удалятся');
        if (!confirm('Позиция «' + res.name + '» используется:\n• ' + parts.join('\n• ') + '\n\nИстория в журнале сохранится. Удалить?')) return;
        res = await api('deleteItem', { id: i.id, force: true });
      }
      reloadStock(res.message);
    } catch (e) { toast(e.message, true); }
  }

  function stockRow(i) {
    const tr = el('tr');
    const save = async (field, value) => {
      tr.classList.add('saving');
      try {
        const it = await api('updateItem', { id: i.id, field, value });
        Object.assign(i, it);
        if (field === 'Категория' && value && catalogCache.categories.indexOf(it.category) < 0) catalogCache.categories.push(it.category);
        if (field === 'Категория') { reloadStock('«' + i.name + '» → ' + (it.category || NO_CAT)); return; }   // позиция переехала в другую группу
        tr.replaceWith(stockRow(i));
        toast('Сохранено: ' + i.name);
      } catch (e) { toast(e.message, true); tr.classList.remove('saving'); }
    };
    const cat = el('select', { 'aria-label': 'Категория' },
      el('option', { value: '', text: '—' }), ...catalogCache.categories.map(x => el('option', { value: x, text: x })),
      el('option', { value: '__new__', text: '+ Новая категория…' }));
    cat.value = i.category || '';
    cat.addEventListener('change', () => {
      if (cat.value === '__new__') {
        const n = prompt('Название новой категории');
        if (!n) { cat.value = i.category || ''; return; }
        save('Категория', n.trim());
      } else save('Категория', cat.value);
    });
    const emp = el('select', { 'aria-label': 'Выдаётся сотрудникам' }, el('option', { value: 'да', text: 'да' }), el('option', { value: 'нет', text: 'нет' }));
    emp.value = i.forEmployees ? 'да' : 'нет';
    emp.addEventListener('change', () => save('Выдаётся сотрудникам', emp.value));
    const aud = el('select', { 'aria-label': 'Кому выдаётся', disabled: !i.forEmployees },
      el('option', { value: '', text: '—' }), ...catalogCache.audiences.map(x => el('option', { value: x, text: x })));
    aud.value = i.audience || '';
    aud.addEventListener('change', () => save('Кому выдаётся', aud.value));
    const min = el('input', { type: 'number', min: '0', value: String(i.min), 'aria-label': 'Минимальный остаток' });
    min.addEventListener('change', () => save('Мин. остаток', min.value));
    const tagCls = i.inStock <= 0 ? 'tag zero' : (i.status === 'Докупить' ? 'tag low' : 'tag');
    const op = el('span', { class: 'row-actions' },
      el('button', { class: 'link', type: 'button', text: 'Операция', onclick: () => openOp(i.name) }),
      el('button', { class: 'link danger-link', type: 'button', text: 'Удалить', onclick: () => deleteItem(i) }));
    tr.append(
      el('td', {}, el('b', { text: i.name }), el('span', { class: 'sub', text: i.id })),
      el('td', {}, cat), el('td', {}, emp), el('td', {}, aud), el('td', { class: 'n' }, min),
      el('td', { class: 'n' }, el('span', { class: tagCls, text: String(i.inStock) })),
      el('td', { class: 'n', text: String(i.reserved) }),
      el('td', { class: 'n', text: String(i.available) }),
      el('td', {}, op));
    return tr;
  }

  // ---------- Названия позиций: переименовать и объединить ----------

  let renameDlg = null;
  async function openRename() {
    if (!renameDlg) {
      renameDlg = el('dialog', { class: 'sheet wide' });
      document.body.append(renameDlg);
    }
    const body = el('div', { class: 'sheet-body' }, el('div', { class: 'loading', text: 'Загружаю позиции…' }));
    const apply = el('button', { class: 'btn', type: 'button', text: 'Применить', disabled: true });
    const err = el('p', { class: 'err', role: 'alert' });
    renameDlg.replaceChildren(el('div', { class: 'sheet-form' },
      el('header', { class: 'sheet-head' }, el('h2', { text: 'Названия позиций' }),
        el('button', { class: 'link', type: 'button', text: 'Закрыть', onclick: () => renameDlg.close() })),
      body,
      el('footer', { class: 'sheet-foot' }, err, apply)));
    renameDlg.showModal();

    let data;
    try { data = await api('suggestNames'); } catch (e) { body.replaceChildren(el('div', { class: 'note bad', text: e.message })); return; }

    const rows = data.items.map(i => {
      const input = el('input', { type: 'text', value: i.suggestion, 'aria-label': 'Новое название для «' + i.name + '»' });
      const note = el('td', { class: 'small' });
      return { i, input, note, tr: el('tr', {}, el('td', {}, el('b', { text: i.name }), el('span', { class: 'sub', text: (i.category || 'без категории') + ', на складе ' + i.inStock })), el('td', {}, input), note) };
    });
    const refresh = () => {
      const byName = {};
      rows.forEach(r => { const k = norm(r.input.value); (byName[k] = byName[k] || []).push(r); });
      let n = 0;
      rows.forEach(r => {
        const to = r.input.value.trim();
        const same = byName[norm(to)].filter(x => x !== r);
        r.tr.classList.toggle('changed', to !== r.i.name);
        if (!to) { r.note.textContent = 'пустое — останется как есть'; r.note.className = 'small muted'; return; }
        if (same.length) { r.note.textContent = 'объединится с «' + same.map(x => x.i.name).join('», «') + '»'; r.note.className = 'small warn-text'; n++; return; }
        if (to !== r.i.name) { r.note.textContent = 'переименуется'; r.note.className = 'small ok-text'; n++; return; }
        r.note.textContent = 'без изменений'; r.note.className = 'small muted';
      });
      apply.disabled = !n;
      apply.textContent = n ? 'Применить (' + n + ')' : 'Применить';
    };
    rows.forEach(r => r.input.addEventListener('input', refresh));

    // Строка состояния ИИ: таблица уже работает, предложения ИИ подставятся, когда придут
    const aiLine = el('div', { class: 'note ai-line' });
    const askAi = async () => {
      aiLine.className = 'note ai-line';
      aiLine.replaceChildren(el('span', { text: 'ИИ подбирает названия: единственное число, без капса, понятные слова… Обычно это до минуты. Пока можно править вручную.' }));
      try {
        const res = await api('aiNames');
        let n = 0;
        rows.forEach(r => {
          const s = res.names[r.i.name];
          if (!s || r.input.dataset.edited) return;            // то, что вы уже поправили, не трогаем
          r.input.value = s; n++;
        });
        refresh();
        aiLine.className = 'note ok ai-line';
        aiLine.replaceChildren(el('span', { text: 'ИИ предложил названия. Проверьте и поправьте, где нужно.' }));
      } catch (e) {
        aiLine.className = 'note warn ai-line';
        const again = el('button', { class: 'btn ghost small', type: 'button', text: 'Спросить ИИ ещё раз' });
        again.addEventListener('click', askAi);
        aiLine.replaceChildren(el('span', { text: 'ИИ не ответил вовремя (обычно это перегрузка у Google на пару минут). Предложен только аккуратный регистр — можно поправить вручную или спросить ещё раз.' }), again);
      }
    };
    rows.forEach(r => r.input.addEventListener('input', () => { r.input.dataset.edited = '1'; }));

    body.replaceChildren(
      data.aiReady ? aiLine : el('div', { class: 'note ai-line', text: 'ИИ не настроен — предложен только аккуратный регистр.' }),
      el('p', { class: 'muted small', text: 'Название поменяется везде: на складе, в журнале, в «Выдано», в мебели по местам и в заявках. ' +
        'Если у двух позиций одинаковое название — они объединятся в одну. Старые названия система запомнит для следующих загрузок из файла.' }),
      el('div', { class: 'table-wrap' }, el('table', {},
        el('thead', {}, el('tr', {}, el('th', { text: 'Сейчас' }), el('th', { text: 'Станет' }), el('th', { text: '' }))),
        el('tbody', {}, ...rows.map(r => r.tr)))));
    refresh();
    if (data.aiReady) askAi();

    apply.onclick = async () => {
      const changes = rows.filter(r => r.input.value.trim() && r.input.value.trim() !== r.i.name).map(r => ({ id: r.i.id, to: r.input.value.trim() }));
      const merges = rows.filter(r => /объединится/.test(r.note.textContent)).length;
      if (merges && !confirm('Некоторые позиции объединятся в одну: их остатки и история сложатся. Отменить это потом нельзя. Продолжить?')) return;
      apply.disabled = true; apply.textContent = 'Применяю…'; err.textContent = '';
      try {
        const res = await api('renameItems', { changes });
        toast(res.message);
        renameDlg.close();
        catalogCache = null;
        if (location.hash === '#stock') route();
      } catch (e) { err.textContent = e.message; apply.disabled = false; apply.textContent = 'Применить'; }
    };
  }

  // ---------- Операция со складом ----------

  const OP_HINT = {
    in: 'Пришло от поставщика — количество на складе увеличится.',
    install: 'По этажам офиса: со склада или то, что уже стоит на местах. Появится в «Мебели по местам».',
    writeoff: 'Сломано или утеряно — уйдёт со склада.',
    adjust: 'После пересчёта: поправить количество на складе.'
  };

  async function openOp(itemName) {
    const c = catalogCache || await loadCatalog();
    $('opItem').replaceChildren(...c.items.map(i => el('option', { value: i.name, text: i.name })),
      el('option', { value: '__new__', text: '+ Новая позиция' }));
    if (itemName) $('opItem').value = itemName;
    $('opCats').replaceChildren(...c.categories.map(x => el('option', { value: x })));
    $('opNewAud').replaceChildren(...c.audiences.map(x => el('option', { value: x, text: x })));
    $('opFloors').replaceChildren(...Array.from({ length: c.floors }, (_, k) => el('tr', {},
      el('td', { text: 'Этаж ' + (k + 1) }),
      el('td', {}, el('input', { type: 'number', min: '0', value: '', placeholder: '0', 'data-floor': String(k + 1), 'aria-label': 'Количество на этаж ' + (k + 1) })),
      el('td', {}, el('input', { type: 'text', 'data-room': String(k + 1), placeholder: 'например, кухня', 'aria-label': 'Зона на этаже ' + (k + 1) })))));
    $('opInPlace').checked = false;
    $('opErr').textContent = '';
    updateOp();
    $('opDialog').showModal();
  }

  function updateOp() {
    const t = document.querySelector('input[name=opType]:checked').value;
    const isNew = $('opItem').value === '__new__';
    $('opHint').textContent = OP_HINT[t];
    $('opNew').classList.toggle('hidden', !isNew);
    $('opNewAudWrap').classList.toggle('hidden', !$('opNewEmp').checked);
    $('opSignWrap').classList.toggle('hidden', t !== 'adjust');
    $('opPlace').classList.toggle('hidden', t !== 'install');
    $('opQtyWrap').classList.toggle('hidden', t === 'install');
    if (t === 'install') {
      const total = opPlaces().reduce((s, p) => s + p.qty, 0);
      const it0 = catalogCache && catalogCache.items.find(i => i.name === $('opItem').value);
      $('opTotal').textContent = 'Всего: ' + total + ' шт.' + (!$('opInPlace').checked && it0 ? ' Со склада спишется столько же (на складе ' + it0.inStock + ').' : '');
      $('opTotal').className = 'small ' + (!$('opInPlace').checked && it0 && total > it0.inStock ? 'err' : 'muted');
    }
    const it = catalogCache && catalogCache.items.find(i => i.name === $('opItem').value);
    $('opStock').textContent = it ? 'На складе: ' + it.inStock + ' шт., доступно для выдачи: ' + it.available : '';
  }
  $('opForm').addEventListener('change', updateOp);
  $('opForm').addEventListener('input', e => { if (e.target.closest('#opFloors')) updateOp(); });
  function opPlaces() {
    return [...document.querySelectorAll('#opFloors input[data-floor]')].map(x => ({
      floor: x.dataset.floor, qty: Math.max(0, parseInt(x.value, 10) || 0),
      room: document.querySelector('#opFloors input[data-room="' + x.dataset.floor + '"]').value.trim()
    })).filter(p => p.qty > 0);
  }
  $('opAllFloors').addEventListener('click', () => { document.querySelectorAll('#opFloors input[data-floor]').forEach(x => { x.value = '1'; }); updateOp(); });
  $('opClearFloors').addEventListener('click', () => { document.querySelectorAll('#opFloors input').forEach(x => { x.value = ''; }); updateOp(); });
  $('opDialog').querySelector('[data-close]').addEventListener('click', () => $('opDialog').close());

  $('opForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const isNew = $('opItem').value === '__new__';
    const op = {
      type: document.querySelector('input[name=opType]:checked').value,
      item: isNew ? '' : $('opItem').value, qty: $('opQty').value, sign: $('opSign').value,
      places: opPlaces(), inPlace: $('opInPlace').checked, comment: $('opComment').value.trim(),
      newItem: isNew ? { name: $('opNewName').value.trim(), category: $('opNewCat').value.trim(),
        forEmployees: $('opNewEmp').checked, audience: $('opNewEmp').checked ? $('opNewAud').value : '' } : null
    };
    if (isNew && !op.newItem.name) { $('opErr').textContent = 'Введите название новой позиции.'; return; }
    if (op.type === 'install' && !op.places.length) { $('opErr').textContent = 'Укажите количество хотя бы для одного этажа.'; return; }
    $('opSend').disabled = true; $('opSend').textContent = 'Провожу…';
    try {
      const res = await api('operation', { op });
      toast(res.message);
      $('opDialog').close();
      $('opNewName').value = ''; $('opComment').value = ''; $('opQty').value = '1';
      catalogCache = null;
      if (/^#(stock|overview|furniture)?$/.test(location.hash)) route();
    } catch (e) {
      $('opErr').textContent = e.message;
    } finally { $('opSend').disabled = false; $('opSend').textContent = 'Провести'; }
  });

  // ---------- Выдано ----------

  async function issued(main) {
    const q = el('input', { type: 'search', placeholder: 'Логин, стол или позиция' });
    const all = el('select', { 'aria-label': 'Что показать' },
      el('option', { value: 'active', text: 'Числится сейчас' }), el('option', { value: 'all', text: 'Вся история' }));
    const box = el('div');
    const load = async () => {
      box.replaceChildren(el('div', { class: 'loading', text: 'Загружаю…' }));
      try {
        const rows = await api('issued', { q: q.value, active: all.value === 'active' });
        box.replaceChildren(rows.length
          ? el('div', { class: 'table-wrap' }, el('table', {},
              el('thead', {}, el('tr', {}, ...['Логин', 'Этаж', 'Стол', 'Позиция', 'Формат', 'Выдано', '№ заявки', 'Статус', ''].map(h => el('th', { text: h })))),
              el('tbody', {}, ...rows.map(r => el('tr', {},
                el('td', { text: r['Логин'] || '—' }), el('td', { text: r['Этаж'] }), el('td', { text: r['Стол'] }),
                el('td', {}, el('b', { text: r['Позиция'] })), el('td', { text: r['Формат работы'] }),
                el('td', { text: fmtDate(r['Дата выдачи']) }), el('td', { text: r['№ заявки'] }),
                el('td', {}, el('span', { class: 'status ' + (r['Статус'] === 'Числится' ? 'done' : 'off'), text: r['Статус'] + (r['Дата сдачи'] ? ' ' + fmtDate(r['Дата сдачи']) : '') })),
                el('td', {}, el('button', { class: 'link danger-link', type: 'button', text: 'Удалить', onclick: () => delIssued(r) })))))))
          : empty('Ничего не найдено'));
        box.prepend(el('p', { class: 'muted small', style: 'margin-bottom:8px', text: 'Показано: ' + rows.length }));
      } catch (e) { box.replaceChildren(el('div', { class: 'note bad', text: e.message })); }
    };
    q.addEventListener('input', debounce(load, 400));
    all.addEventListener('change', load);

    async function delIssued(r) {
      const who = (r['Логин'] && r['Логин'] !== '-' ? r['Логин'] : 'стол ' + r['Стол']);
      if (!confirm('Удалить запись «' + r['Позиция'] + '» — ' + who + '?\n\nСклад не изменится. Если вещь вернули — лучше оформить заявку «Сдать».')) return;
      try { const res = await api('deleteIssued', { row: r._row }); toast(res.message); load(); }
      catch (e) { toast(e.message, true); }
    }
    const clearBtn = el('button', { class: 'btn danger', type: 'button', text: 'Очистить…' });
    clearBtn.addEventListener('click', () => formDialog({
      title: 'Очистить «Выдано»', submit: 'Удалить записи',
      fields: [{ key: 'scope', label: 'Что удалить', type: 'select', value: 'import', options: [
        { value: 'import', text: 'Только загруженное из файла («импорт»)' },
        { value: 'all', text: 'Все записи о выдаче — и по заявкам тоже' }] }],
      onSubmit: async v => {
        const text = v.scope === 'all'
          ? 'Удалить ВСЕ сведения о том, что за кем числится?\n\nОстатки склада и журнал выдач по заявкам сохранятся. Отменить нельзя.'
          : 'Удалить все записи, загруженные из файла?\n\nОстатки склада не изменятся. Отменить нельзя.';
        if (!confirm(text)) throw new Error('Отменено.');
        const res = await api('clearIssued', { scope: v.scope });
        toast(res.message); load();
      }
    }));

    main.replaceChildren(head('Выдано сотрудникам', 'Что за кем числится. Появляется после «Выдано» по заявке или при загрузке из файла.', clearBtn),
      el('div', { class: 'toolbar' }, q, all), box);
    await load();
  }

  // ---------- Мебель по местам ----------

  async function furniture(main) {
    const rows = await api('furniture');
    const byFloor = {};
    rows.forEach(r => { (byFloor[r['Этаж']] = byFloor[r['Этаж']] || []).push(r); });
    const nFloors = Math.max((meta && meta.floors) || 0, ...rows.map(r => Number(r['Этаж']) || 0));
    const floorList = Array.from({ length: nFloors }, (_, k) => k + 1);
    const opBtn = el('button', { class: 'btn', type: 'button', text: 'Расставить по этажам' });
    opBtn.addEventListener('click', async () => { await openOp(); document.querySelector('input[name=opType][value=install]').checked = true; updateOp(); });

    // Сводка по офису: позиция × этаж
    const totals = {};
    rows.forEach(r => {
      const t = totals[r['Позиция']] = totals[r['Позиция']] || { all: 0 };
      const q = Number(r['Количество']) || 0;
      t[r['Этаж']] = (t[r['Этаж']] || 0) + q; t.all += q;
    });
    const names = Object.keys(totals).sort((x, y) => x.localeCompare(y, 'ru'));
    const summary = el('div', { class: 'table-wrap', style: 'margin-bottom:24px' }, el('table', { class: 'matrix' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Позиция' }), ...floorList.map(f => el('th', { class: 'n', text: f + ' эт.' })), el('th', { class: 'n', text: 'Всего' }))),
      el('tbody', {}, ...names.map(n => el('tr', {}, el('td', {}, el('b', { text: n })),
        ...floorList.map(f => el('td', { class: 'n' + (totals[n][f] ? '' : ' muted'), text: totals[n][f] ? String(totals[n][f]) : '—' })),
        el('td', { class: 'n' }, el('span', { class: 'tag', text: String(totals[n].all) })))))));

    const floors = Object.keys(byFloor).sort((x, y) => Number(x) - Number(y));
    main.replaceChildren(
      head('Мебель по местам', 'Что стоит на этажах и в общих зонах офиса и ни за кем не числится.', opBtn),
      rows.length ? el('div', {},
        el('h2', { style: 'margin-bottom:10px', text: 'По офису' }), summary,
        el('h2', { style: 'margin-bottom:10px', text: 'По зонам' }),
        el('div', { class: 'table-wrap' }, el('table', {},
          el('thead', {}, el('tr', {}, el('th', { text: 'Помещение / зона' }), el('th', { text: 'Позиция' }), el('th', { class: 'n', text: 'Кол-во' }), el('th', { text: 'Комментарий' }))),
          el('tbody', {}, ...floors.flatMap(f => [
            el('tr', { class: 'floor-head' }, el('td', { colspan: 4, text: 'Этаж ' + f })),
            ...byFloor[f].map(r => el('tr', {}, el('td', { text: r['Помещение / зона'] || '—' }), el('td', {}, el('b', { text: r['Позиция'] })),
              el('td', { class: 'n', text: String(r['Количество']) }), el('td', { class: 'muted', text: r['Комментарий'] })))
          ])))))
        : empty('Пока ничего не расставлено. Нажмите «Расставить по этажам».'));
  }

  // ---------- Журнал ----------

  function opClass(op) {
    if (/^(Поступление|Начальный)/.test(op)) return 'in';
    if (/^(Выдача|Установка|Выдано ранее)/.test(op)) return 'out';
    if (/^Возврат/.test(op)) return 'ret';
    if (/^Списание/.test(op)) return 'off';
    return '';
  }

  async function journal(main) {
    const iso = d => d.toISOString().slice(0, 10);
    const from = el('input', { type: 'date', 'aria-label': 'С даты' });
    const to = el('input', { type: 'date', 'aria-label': 'По дату' });
    const d30 = new Date(); d30.setDate(d30.getDate() - 29);
    from.value = iso(d30); to.value = iso(new Date());
    const q = el('input', { type: 'search', placeholder: 'Позиция, логин, № заявки, комментарий' });
    const op = el('select', { 'aria-label': 'Операция' }, el('option', { value: '', text: 'Все операции' }));
    const box = el('div');
    const more = el('button', { class: 'btn ghost hidden', type: 'button', text: 'Показать ещё' });
    let rows = [], total = 0;
    const draw = () => {
      const days = [];
      rows.forEach(r => { const last = days[days.length - 1]; if (last && last.day === r.day) last.rows.push(r); else days.push({ day: r.day, rows: [r] }); });
      box.replaceChildren(el('p', { class: 'muted small', style: 'margin-bottom:8px', text: 'Найдено записей: ' + total }),
        ...(days.length ? days.map(g => el('details', { class: 'day', open: true },
          el('summary', {}, el('b', { text: fmtDay(g.day) }), el('span', { class: 'muted small', text: g.rows.length + ' ' + plural(g.rows.length, 'запись', 'записи', 'записей') })),
          el('div', { class: 'table-wrap' }, el('table', {}, el('tbody', {}, ...g.rows.map(r => el('tr', {},
            el('td', { class: 'muted', text: r.time }),
            el('td', {}, el('span', { class: 'op ' + opClass(r['Операция']), text: r['Операция'] })),
            el('td', {}, el('b', { text: r['Позиция'] })),
            el('td', { class: 'n', text: r['Кол-во'] + ' шт.' }),
            el('td', { class: 'muted', text: [r['Откуда'], r['Куда']].filter(Boolean).join(' → ') }),
            el('td', { text: [r['Логин'], r['Этаж'] ? 'этаж ' + r['Этаж'] : '', r['Стол'] ? 'стол ' + r['Стол'] : ''].filter(Boolean).join(', ') }),
            el('td', { text: r['№ заявки'] }),
            el('td', { class: 'muted small', text: [r['Кто провёл'], r['Комментарий']].filter(Boolean).join('. ') }))))))))
          : [empty('Ничего не найдено. Измените поиск или период.')]));
      more.classList.toggle('hidden', rows.length >= total);
    };
    const load = async append => {
      if (!append) box.replaceChildren(el('div', { class: 'loading', text: 'Загружаю…' }));
      try {
        const res = await api('journal', { filter: { q: q.value, op: op.value, from: from.value, to: to.value, offset: append ? rows.length : 0 } });
        rows = append ? rows.concat(res.rows) : res.rows;
        total = res.total;
        if (op.options.length === 1) res.ops.forEach(o => op.append(el('option', { value: o, text: o })));
        draw();
      } catch (e) { box.replaceChildren(el('div', { class: 'note bad', text: e.message })); }
    };
    q.addEventListener('input', debounce(() => load(false), 400));
    [op, from, to].forEach(x => x.addEventListener('change', () => load(false)));
    more.addEventListener('click', () => load(true));
    main.replaceChildren(head('Журнал операций', 'Каждое движение по складу: поступления, выдачи, возвраты, списания.'),
      el('div', { class: 'toolbar' }, q, op, from, to), box, more);
    await load(false);
  }

  // ---------- Ответственные ----------

  async function team(main) {
    let info = await api('responsibles');
    const receivers = el('p', { class: 'receivers' });
    const tbody = el('tbody');
    const showReceivers = () => {
      receivers.replaceChildren(el('span', { class: 'muted', text: 'Сейчас уведомления о заявках получает: ' }),
        el('b', { text: info.receivers.length ? info.receivers.join(', ') : 'никто — проверьте Telegram и «Уведомления»' }));
    };

    // Куда слать: общий чат или лично
    const mode = el('select', { 'aria-label': 'Куда слать уведомления' }, ...info.modes.map(m => el('option', { value: m, text: m })));
    mode.value = info.mode;
    const group = el('input', { type: 'text', value: info.group, placeholder: 'chat_id общего чата, например -1001234567890' });
    const groupWrap = el('label', { class: 'field' }, el('span', { text: 'chat_id общего чата' }), group,
      el('span', { class: 'small muted', text: 'Добавьте бота в рабочий чат и напишите там /chatid — бот пришлёт номер.' }));
    const saveMode = async () => {
      try { info = await api('saveNotifyMode', { mode: mode.value, group: group.value }); showReceivers(); toast('Сохранено'); }
      catch (e) { toast(e.message, true); }
    };
    const syncMode = () => groupWrap.classList.toggle('hidden', mode.value !== 'Общий чат');
    mode.addEventListener('change', () => { syncMode(); saveMode(); });
    group.addEventListener('change', saveMode);
    syncMode();

    const iso = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

    function personRow(p) {
      const tr = el('tr');
      const name = el('input', { type: 'text', value: p.name || '', placeholder: 'Имя Фамилия', 'aria-label': 'ФИО' });
      const role = el('select', { 'aria-label': 'Роль' }, ...info.roles.map(r => el('option', { value: r, text: r }))); role.value = p.role || info.roles[0];
      const login = el('input', { type: 'text', value: p.login || '', placeholder: 'логин', 'aria-label': 'Логин' });
      const tg = el('input', { type: 'text', value: p.username ? '@' + p.username : '', placeholder: '@username', 'aria-label': 'Telegram' });
      const notify = el('select', { 'aria-label': 'Получает уведомления' }, el('option', { value: 'да', text: 'да' }), el('option', { value: 'нет', text: 'нет' }));
      notify.value = p.row && !p.notify ? 'нет' : 'да';
      const status = el('select', { 'aria-label': 'Статус' }, ...info.statuses.map(s => el('option', { value: s, text: s }))); status.value = p.status || info.statuses[0];
      const until = el('input', { type: 'date', value: iso(p.until), 'aria-label': 'Отсутствует до' });
      const linked = el('span', { class: 'small ' + (p.chatId ? 'ok-text' : 'muted'), text: p.chatId ? 'подключён' : (p.username ? 'нужно написать боту /start' : '—') });
      const away = el('span', { class: 'status ' + (p.absent ? 'off' : 'done'), text: p.absent ? 'отсутствует' : 'на месте' });
      const syncUntil = () => { until.disabled = status.value === info.statuses[0]; if (until.disabled) until.value = ''; };
      syncUntil();
      const save = async () => {
        if (!name.value.trim() && !tg.value.trim()) return;      // пустую строку не сохраняем
        tr.classList.add('saving');
        try {
          info = await api('saveResponsible', { person: { row: p.row || null, name: name.value, role: role.value, login: login.value,
            username: tg.value, notify: notify.value === 'да', status: status.value, until: until.value } });
          showReceivers();
          if (!p.row) { drawRows(); toast('Добавлено: ' + (name.value || tg.value)); return; }
          const fresh = info.list.find(x => x.row === p.row) || p;
          Object.assign(p, fresh);
          tr.replaceWith(personRow(p));
          toast('Сохранено: ' + (p.name || '@' + p.username));
        } catch (e) { toast(e.message, true); tr.classList.remove('saving'); }
      };
      status.addEventListener('change', syncUntil);
      [name, role, login, tg, notify, status, until].forEach(x => x.addEventListener('change', save));
      const del = el('button', { class: 'link danger-link', type: 'button', text: p.row ? 'Удалить' : 'Убрать' });
      del.addEventListener('click', async () => {
        if (!p.row) { tr.remove(); return; }
        if (!confirm('Удалить «' + (p.name || p.username) + '» из ответственных?')) return;
        try { info = await api('deleteResponsible', { row: p.row }); showReceivers(); drawRows(); toast('Удалено'); }
        catch (e) { toast(e.message, true); }
      });
      tr.append(el('td', {}, name), el('td', {}, role), el('td', {}, login), el('td', {}, tg, el('div', {}, linked)),
        el('td', {}, notify), el('td', {}, status, el('div', { style: 'margin-top:4px' }, away)), el('td', {}, until), el('td', {}, del));
      return tr;
    }
    const drawRows = () => tbody.replaceChildren(...info.list.map(personRow));

    const add = el('button', { class: 'btn ghost', type: 'button', text: '+ Добавить человека' });
    add.addEventListener('click', () => {
      const tr = personRow({ row: null, role: info.list.some(x => x.role === 'Ответственный') ? 'Заместитель' : 'Ответственный', notify: true });
      tbody.append(tr);
      tr.querySelector('input').focus();
    });

    main.replaceChildren(
      head('Ответственные', 'Кто ведёт склад офиса и получает уведомления о заявках.'),
      el('div', { class: 'panel team-settings' },
        el('label', { class: 'field' }, el('span', { text: 'Куда слать уведомления' }), mode), groupWrap),
      el('div', { class: 'note', style: 'margin:14px 0' },
        el('p', { text: 'Когда основной ответственный в отпуске или на больничном, уведомления получают заместители. После даты «до» он снова считается на месте — менять статус обратно не нужно.' }),
        el('p', { class: 'small muted', style: 'margin-top:6px', text: 'Чтобы получать уведомления лично, человек пишет боту в Telegram /start — тогда появится «подключён». Работает при способе «Лично ответственным».' })),
      receivers,
      el('div', { class: 'table-wrap' }, el('table', { class: 'team' },
        el('thead', {}, el('tr', {}, ...['ФИО', 'Роль', 'Логин', 'Telegram', 'Уведомления', 'Статус', 'Отсутствует до', ''].map(h => el('th', { text: h })))),
        tbody)),
      el('div', { class: 'toolbar', style: 'margin-top:12px' }, add));
    showReceivers();
    drawRows();
  }

  // ---------- Загрузка из файла ----------

  async function importView(main) {
    if (!window.TMCImport) throw new Error('Модуль загрузки не подключён');
    await window.TMCImport.render(main, { api, toast, head });
  }

  // ---------- Старт ----------

  if (!offices.length) {
    document.body.replaceChildren(el('div', { class: 'login' }, el('div', { class: 'note bad', text: 'Не настроен ни один офис: заполните файл offices.js.' })));
  } else if (session && session.token && TMC.office(session.officeId)) {
    startApp();
  } else {
    showLogin();
  }
})();
