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

  const VIEWS = { overview, requests, stock, issued, furniture, journal, import: importView };

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

  async function stock(main) {
    const c = await loadCatalog();
    const q = el('input', { type: 'search', placeholder: 'Поиск по позиции или категории' });
    const tbody = el('tbody');
    const render = () => {
      const w = norm(q.value);
      const rows = c.items.filter(i => !w || norm(i.name + ' ' + i.category).indexOf(w) >= 0);
      tbody.replaceChildren(...(rows.length ? rows.map(stockRow) : [el('tr', {}, el('td', { colspan: 9 }, empty('Ничего не найдено')))]));
    };
    q.addEventListener('input', render);
    const opBtn = el('button', { class: 'btn', type: 'button', text: 'Операция со складом' });
    opBtn.addEventListener('click', () => openOp());
    const nameBtn = el('button', { class: 'btn ghost', type: 'button', text: 'Привести названия в порядок' });
    nameBtn.addEventListener('click', () => openRename());
    main.replaceChildren(
      head('Склад', c.items.length + ' ' + plural(c.items.length, 'позиция', 'позиции', 'позиций') + '. Категорию, выдачу и минимум можно менять прямо в таблице.', nameBtn, opBtn),
      el('div', { class: 'toolbar' }, q),
      el('div', { class: 'table-wrap' }, el('table', {},
        el('thead', {}, el('tr', {}, ...['Позиция', 'Категория', 'Сотрудникам', 'Кому', 'Мин.', 'На складе', 'В работе', 'Доступно', ''].map((h, i) =>
          el('th', { class: i >= 4 && i <= 7 ? 'n' : '', text: h })))),
        tbody)));
    render();
  }

  function stockRow(i) {
    const tr = el('tr');
    const save = async (field, value) => {
      tr.classList.add('saving');
      try {
        const it = await api('updateItem', { id: i.id, field, value });
        Object.assign(i, it);
        if (field === 'Категория' && value && catalogCache.categories.indexOf(it.category) < 0) catalogCache.categories.push(it.category);
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
    const op = el('button', { class: 'link', type: 'button', text: 'Операция' });
    op.addEventListener('click', () => openOp(i.name));
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
    install: 'Со склада в общую зону офиса: появится в «Мебели по местам».',
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
    $('opFloor').replaceChildren(...Array.from({ length: c.floors }, (_, k) => el('option', { value: String(k + 1), text: String(k + 1) })));
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
    const it = catalogCache && catalogCache.items.find(i => i.name === $('opItem').value);
    $('opStock').textContent = it ? 'На складе: ' + it.inStock + ' шт., доступно для выдачи: ' + it.available : '';
  }
  $('opForm').addEventListener('change', updateOp);
  $('opDialog').querySelector('[data-close]').addEventListener('click', () => $('opDialog').close());

  $('opForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const isNew = $('opItem').value === '__new__';
    const op = {
      type: document.querySelector('input[name=opType]:checked').value,
      item: isNew ? '' : $('opItem').value, qty: $('opQty').value, sign: $('opSign').value,
      floor: $('opFloor').value, room: $('opRoom').value.trim(), comment: $('opComment').value.trim(),
      newItem: isNew ? { name: $('opNewName').value.trim(), category: $('opNewCat').value.trim(),
        forEmployees: $('opNewEmp').checked, audience: $('opNewEmp').checked ? $('opNewAud').value : '' } : null
    };
    if (isNew && !op.newItem.name) { $('opErr').textContent = 'Введите название новой позиции.'; return; }
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
              el('thead', {}, el('tr', {}, ...['Логин', 'Этаж', 'Стол', 'Позиция', 'Формат', 'Выдано', '№ заявки', 'Статус'].map(h => el('th', { text: h })))),
              el('tbody', {}, ...rows.map(r => el('tr', {},
                el('td', { text: r['Логин'] || '—' }), el('td', { text: r['Этаж'] }), el('td', { text: r['Стол'] }),
                el('td', {}, el('b', { text: r['Позиция'] })), el('td', { text: r['Формат работы'] }),
                el('td', { text: fmtDate(r['Дата выдачи']) }), el('td', { text: r['№ заявки'] }),
                el('td', {}, el('span', { class: 'status ' + (r['Статус'] === 'Числится' ? 'done' : 'off'), text: r['Статус'] + (r['Дата сдачи'] ? ' ' + fmtDate(r['Дата сдачи']) : '') })))))))
          : empty('Ничего не найдено'));
        box.prepend(el('p', { class: 'muted small', style: 'margin-bottom:8px', text: 'Показано: ' + rows.length }));
      } catch (e) { box.replaceChildren(el('div', { class: 'note bad', text: e.message })); }
    };
    q.addEventListener('input', debounce(load, 400));
    all.addEventListener('change', load);
    main.replaceChildren(head('Выдано сотрудникам', 'Что за кем числится. Появляется после «Выдано» по заявке или при загрузке из файла.'),
      el('div', { class: 'toolbar' }, q, all), box);
    await load();
  }

  // ---------- Мебель по местам ----------

  async function furniture(main) {
    const rows = await api('furniture');
    const byFloor = {};
    rows.forEach(r => { (byFloor[r['Этаж']] = byFloor[r['Этаж']] || []).push(r); });
    const floors = Object.keys(byFloor).sort((a, b) => Number(a) - Number(b));
    const opBtn = el('button', { class: 'btn', type: 'button', text: 'Установить со склада' });
    opBtn.addEventListener('click', async () => { await openOp(); document.querySelector('input[name=opType][value=install]').checked = true; updateOp(); });
    main.replaceChildren(
      head('Мебель по местам', 'Что стоит в общих зонах офиса и ни за кем не числится.', opBtn),
      rows.length
        ? el('div', { class: 'table-wrap' }, el('table', {},
            el('thead', {}, el('tr', {}, el('th', { text: 'Помещение / зона' }), el('th', { text: 'Позиция' }), el('th', { class: 'n', text: 'Кол-во' }), el('th', { text: 'Комментарий' }))),
            el('tbody', {}, ...floors.flatMap(f => [
              el('tr', { class: 'floor-head' }, el('td', { colspan: 4, text: 'Этаж ' + f })),
              ...byFloor[f].map(r => el('tr', {}, el('td', { text: r['Помещение / зона'] || '—' }), el('td', {}, el('b', { text: r['Позиция'] })),
                el('td', { class: 'n', text: String(r['Количество']) }), el('td', { class: 'muted', text: r['Комментарий'] })))
            ]))))
        : empty('Пока ничего не установлено. Нажмите «Установить со склада».'));
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
