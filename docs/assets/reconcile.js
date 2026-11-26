/* Сверка «Выдано» с инвентаризацией: что добавить, что снять (и куда делась вещь), у кого сменился стол.
   Вызывается из загрузки (import.js), когда выбрано «Сверка: кто что числит». Сервер — Reconcile.gs. */
(function () {
  const { el } = window.TMC;

  const FATES = [
    { value: 'desk', text: 'Осталось у стола (свободное место)' },
    { value: 'stock', text: 'Вернули на склад' },
    { value: 'place', text: 'Перенесли в другое место…' },
    { value: 'writeoff', text: 'Списали / сняли с учёта' }
  ];

  function render(box, res, ctx) {
    const { api, toast, done } = ctx;
    const check = () => el('input', { type: 'checkbox', checked: true });
    const placeText = (f, d) => [f ? 'этаж ' + f : '', d ? 'стол ' + d : ''].filter(Boolean).join(', ') || '—';

    // ---------- Сводка ----------
    const notes = [];
    notes.push('Файл: ' + res.kind + (res.floors.length ? ', этажи ' + res.floors.join(', ') : '') + ', сотрудников: ' + res.people + '.');
    notes.push('Совпадает и не меняется: ' + res.same + '.');
    if (res.dupes) notes.push('Повторяющиеся строки в файле: ' + res.dupes + ' — учтены один раз.');
    if (res.free) notes.push('Свободных мест в файле: ' + res.free + ' — они в «Выдано» не сверяются.');
    const warn = [];
    if (res.multiDesk.length) warn.push('За несколькими столами в файле: ' + res.multiDesk.map(m => m.login + ' (' + m.desks.join(', ') + ')').join('; ') + '. Проверьте, не дубль ли это.');
    if (res.unknown.length) warn.push('Нет в каталоге, будут заведены новыми позициями: ' + res.unknown.join(', ') + '.');

    // ---------- Добавить ----------
    const addRows = res.add.map(a => ({ a, c: check() }));
    const addSec = section('Добавить — есть в файле, нет в системе', addRows.length,
      table(['', 'Логин', 'Позиция', 'Где'], addRows.map(x => [x.c, x.a.login, el('b', { text: x.a.item }), placeText(x.a.floor, x.a.desk)])));

    // ---------- Сменили стол ----------
    const movRows = res.moved.map(m => ({ m, c: check() }));
    const movSec = section('Сменили стол — обновить этаж и стол', movRows.length,
      table(['', 'Логин', 'Позиция', 'Было', 'Стало'], movRows.map(x => [x.c, x.m.login, el('b', { text: x.m.item }), placeText(x.m.from.floor, x.m.from.desk), placeText(x.m.to.floor, x.m.to.desk)])));

    // ---------- Снять ----------
    const remRows = res.remove.map(r => {
      const opts = (r.suggest === 'handover' ? [{ value: 'handover', text: 'Передано ' + r.toLogin + ' (сидит за этим столом)' }] : []).concat(FATES);
      const fate = el('select', { style: 'min-width:260px' }, ...opts.map(o => el('option', { value: o.value, text: o.text })));
      fate.value = r.suggest || 'desk';
      const toFloor = el('input', { type: 'text', placeholder: 'этаж', value: r.floor || '', style: 'width:70px' });
      const toRoom = el('input', { type: 'text', placeholder: 'помещение / зона', style: 'width:170px' });
      const where = el('div', { class: 'hidden', style: 'display:flex;gap:6px;margin-top:6px' }, toFloor, toRoom);
      fate.addEventListener('change', () => where.classList.toggle('hidden', fate.value !== 'place'));
      return { r, c: check(), fate, toFloor, toRoom, cell: el('div', {}, fate, where) };
    });
    const bulk = el('select', { 'aria-label': 'Для всех отмеченных', style: 'width:auto;max-width:340px' }, el('option', { value: '', text: 'Для всех отмеченных…' }),
      ...FATES.filter(f => f.value !== 'place').map(o => el('option', { value: o.value, text: o.text })));
    bulk.addEventListener('change', () => {
      if (!bulk.value) return;
      remRows.forEach(x => { if (x.c.checked) { x.fate.value = bulk.value; x.fate.dispatchEvent(new Event('change')); } });
      bulk.value = '';
    });
    const remSec = section('Нет в файле — снять с сотрудника', remRows.length,
      el('div', {},
        el('p', { class: 'muted small', style: 'margin:0 0 8px', text: 'Уволился, сдал или передал. Укажите, куда делась каждая вещь.' }),
        remRows.length > 1 ? el('div', { style: 'margin-bottom:8px' }, bulk) : null,
        table(['', 'Логин', 'Позиция', 'Где числилось', 'Куда делась'], remRows.map(x => [x.c, x.r.login, el('b', { text: x.r.item }), placeText(x.r.floor, x.r.desk), x.cell]))));

    // ---------- Запись ----------
    const err = el('p', { class: 'err', role: 'alert' });
    const save = el('button', { class: 'btn', type: 'button', text: 'Записать сверку' });
    const nothing = !addRows.length && !movRows.length && !remRows.length;
    save.addEventListener('click', async () => {
      err.textContent = '';
      const payload = {
        add: addRows.filter(x => x.c.checked).map(x => x.a),
        moved: movRows.filter(x => x.c.checked).map(x => x.m),
        remove: remRows.filter(x => x.c.checked).map(x => Object.assign({}, x.r, {
          fate: x.fate.value, toFloor: x.toFloor.value.trim(), toRoom: x.toRoom.value.trim() }))
      };
      const badPlace = payload.remove.find(x => x.fate === 'place' && !x.toFloor);
      if (badPlace) { err.textContent = 'Укажите этаж, куда перенесли «' + badPlace.item + '» (' + badPlace.login + ').'; return; }
      const n = payload.add.length + payload.moved.length + payload.remove.length;
      if (!n) { err.textContent = 'Ничего не отмечено.'; return; }
      if (!confirm('Записать сверку: добавить ' + payload.add.length + ', сменить стол ' + payload.moved.length +
                   ', снять ' + payload.remove.length + '?')) return;
      save.disabled = true; save.textContent = 'Записываю…';
      try {
        const out = await api('reconcileApply', payload);
        toast(out.message);
        box.replaceChildren(el('div', { class: 'note ok', text: out.message }));
        if (done) done(out);
      } catch (e) { err.textContent = e.message; }
      finally { save.disabled = false; save.textContent = 'Записать сверку'; }
    });

    box.replaceChildren(
      el('h2', { style: 'margin-bottom:8px', text: 'Сверка «Выдано» с файлом' }),
      el('div', { class: 'note' }, ...notes.map(t => el('div', { text: t }))),
      ...warn.map(t => el('div', { class: 'note warn', style: 'margin-top:8px', text: t })),
      nothing ? el('div', { class: 'empty', text: 'Всё совпадает — менять нечего.' }) : el('div', {}, remSec, addSec, movSec),
      nothing ? null : el('div', { class: 'toolbar', style: 'margin-top:16px' }, save, err));
    box.classList.remove('hidden');
  }

  function section(title, n, content) {
    if (!n) return el('div');
    return el('details', { class: 'day', open: true, style: 'margin-top:16px' },
      el('summary', {}, el('b', { text: title }), el('span', { class: 'muted small', text: String(n) })), content);
  }

  function table(head, rows) {
    return el('div', { class: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, ...head.map(h => el('th', { text: h })))),
      el('tbody', {}, ...rows.map(r => el('tr', {}, ...r.map(c => el('td', {}, typeof c === 'string' ? document.createTextNode(c) : c)))))));
  }

  window.TMCReconcile = { render };
})();
