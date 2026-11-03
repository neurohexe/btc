/* Форма заявки сотрудника. Правила те же, что были в Google Форме:
   консультанты и КПБ — нет; удалённый формат — только сдача; гибридный — свой список; по 1 шт. */
(function () {
  const { offices, call, el } = window.TMC;
  const $ = id => document.getElementById(id);
  let meta = null, officeId = null;

  const radio = (name, value, label) =>
    el('label', { class: 'choice' }, el('input', { type: 'radio', name, value }), el('span', { text: label || value }));
  const picked = name => { const r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; };

  function numberSteps() {
    let n = $('stepOffice').classList.contains('hidden') ? 0 : 1;
    document.querySelectorAll('[data-n]').forEach(x => {
      if (x.closest('.hidden')) return;
      x.textContent = ++n;
    });
  }

  function fail(msg) {
    $('loading').classList.add('hidden');
    $('fatal').textContent = msg;
    $('fatal').classList.remove('hidden');
  }

  async function loadOffice(id) {
    officeId = id;
    const o = window.TMC.office(id);
    $('officeName').textContent = o ? o.name : '';
    $('form').classList.add('hidden');
    $('loading').classList.remove('hidden');
    try {
      meta = await call(id, 'formMeta');
    } catch (e) { fail(e.message); return; }
    $('loading').classList.add('hidden');
    if (meta.office) $('officeName').textContent = meta.office;
    build();
    $('form').classList.remove('hidden');
  }

  function build() {
    $('category').replaceChildren(...meta.categories.map(c => radio('category', c)));
    $('floor').replaceChildren(el('option', { value: '', text: 'Выберите этаж' }),
      ...Array.from({ length: meta.floors }, (_, i) => el('option', { value: String(i + 1), text: String(i + 1) })));
    $('format').replaceChildren(...meta.formats.map(f => radio('format', f)));
    $('reason').replaceChildren(...meta.reasons.map(r => radio('reason', r)));
    $('newFormat').replaceChildren(...meta.formats.map(f => radio('newFormat', f)));
    $('returnItems').replaceChildren(...itemChecks(meta.items.ret, 'ret'));
    update();
  }

  function itemChecks(list, name) {
    if (!list.length) return [el('p', { class: 'muted', text: 'Сейчас нет доступных позиций.' })];
    return list.map(n => el('label', { class: 'check' }, el('input', { type: 'checkbox', name, value: n }), el('span', { text: n })));
  }

  function update() {
    const staff = picked('category') === 'Штат';
    const anyCat = !!picked('category');
    $('blocked').classList.toggle('hidden', !anyCat || staff);
    document.querySelectorAll('.staff-only').forEach(x => x.classList.toggle('hidden', !staff));

    const act = picked('action');
    $('orderBox').classList.toggle('hidden', act !== 'Заказать');
    $('returnBox').classList.toggle('hidden', act !== 'Сдать');

    const fmt = picked('format');
    $('remote').classList.toggle('hidden', fmt !== 'Удалённый');
    const list = fmt === 'Офисный' ? meta.items.office : fmt === 'Гибридный' ? meta.items.hybrid : null;
    $('orderItemsQ').classList.toggle('hidden', !list);
    if (list && $('orderItems').dataset.fmt !== fmt) {
      $('orderItems').replaceChildren(...itemChecks(list, 'order'));
      $('orderItems').dataset.fmt = fmt;
    }
    $('newFormatQ').classList.toggle('hidden', picked('reason') !== 'Смена формата работы');
    $('send').disabled = act === 'Заказать' && fmt === 'Удалённый';
    numberSteps();
  }

  $('form').addEventListener('change', update);

  $('form').addEventListener('submit', async ev => {
    ev.preventDefault();
    $('err').textContent = '';
    const act = picked('action');
    const items = [...document.querySelectorAll('input[name="' + (act === 'Сдать' ? 'ret' : 'order') + '"]:checked')].map(x => x.value);
    const req = {
      login: $('login').value.trim(), category: picked('category'), floor: $('floor').value, desk: $('desk').value.trim(),
      action: act, format: picked('format'), items, reason: picked('reason'), newFormat: picked('newFormat'),
      website: document.querySelector('input[name=website]').value
    };
    const miss = !req.login ? 'Укажите логин.' : !req.floor ? 'Выберите этаж.' : !req.desk ? 'Укажите номер стола.'
      : !act ? 'Выберите, что хотите сделать.' : act === 'Заказать' && !req.format ? 'Выберите формат работы.'
      : act === 'Сдать' && !req.reason ? 'Выберите причину сдачи.' : !items.length ? 'Отметьте хотя бы одну позицию.' : '';
    if (miss) { $('err').textContent = miss; return; }

    $('send').disabled = true; $('send').textContent = 'Отправляю…';
    try {
      const res = await call(officeId, 'submitRequest', { request: req });
      $('doneId').textContent = res.id;
      $('doneItems').replaceChildren(...items.map(n => el('li', { text: n })));
      $('form').classList.add('hidden');
      $('done').classList.remove('hidden');
      window.scrollTo(0, 0);
    } catch (e) {
      $('err').textContent = e.message;
    } finally {
      $('send').disabled = false; $('send').textContent = 'Отправить заявку';
    }
  });

  $('again').addEventListener('click', () => {
    $('form').reset();
    $('orderItems').dataset.fmt = '';
    $('done').classList.add('hidden');
    $('form').classList.remove('hidden');
    update();
  });

  // Офис: из ссылки ?office=…, иначе — выбор (если офис один, выбирать нечего)
  const fromUrl = new URLSearchParams(location.search).get('office');
  if (!offices.length) { fail('Не настроен ни один офис (файл offices.js).'); return; }
  const start = window.TMC.office(fromUrl) ? fromUrl : (offices.length === 1 ? offices[0].id : null);
  $('office').replaceChildren(el('option', { value: '', text: 'Выберите офис' }),
    ...offices.map(o => el('option', { value: o.id, text: o.name })));
  if (start) {
    $('stepOffice').classList.add('hidden');
    loadOffice(start);
  } else {
    $('loading').classList.add('hidden');
    $('form').classList.remove('hidden');
    document.querySelectorAll('.step:not(#stepOffice), .submit').forEach(x => x.classList.add('hidden'));
    $('office').addEventListener('change', () => {
      if (!$('office').value) return;
      document.querySelectorAll('.step:not(#stepOffice)').forEach(x => x.classList.remove('hidden'));
      loadOffice($('office').value);
      $('form').classList.remove('hidden');
    });
  }
})();
