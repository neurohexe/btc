/* Загрузка из файла: Excel/CSV/PDF/фото → ИИ или колонки → «Уточните позиции» → проверка → запись.
   Логика та же, что в окне загрузки в таблице (ImportDialog). */
(function () {
  const { el, norm } = window.TMC;
  const AI_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

  async function render(main, ctx) {
    const { api, toast, head } = ctx;
    const meta = await api('importMeta');
    let wb = null, bin = null, pdfRows = null, pending = null;

    // ---------- Разметка ----------
    const target = el('select', { 'aria-label': 'Что загружаем' });
    if (meta.aiReady) target.append(el('option', { value: 'auto', text: 'Всё сразу — ИИ сам разложит' }));
    Object.keys(meta.targets).forEach(k => target.append(el('option', { value: k, text: meta.targets[k].title })));
    const modeDirect = el('input', { type: 'radio', name: 'impMode', value: 'direct', checked: true });
    const modeAi = el('input', { type: 'radio', name: 'impMode', value: 'ai', disabled: !meta.aiReady });
    const hint = el('p', { class: 'muted small' });
    const file = el('input', { type: 'file', accept: '.xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp' });
    const sheet = el('select', { 'aria-label': 'Лист в файле' });
    const sheetWrap = el('label', { class: 'field hidden' }, el('span', { text: 'Лист в файле' }), sheet);
    const paste = el('textarea', { placeholder: 'Или скопируйте строки из таблицы вместе с заголовками и вставьте сюда' });
    const direct = el('input', { type: 'checkbox', checked: false });
    const go = el('button', { class: 'btn', type: 'button', text: 'Разобрать файл' });
    const status = el('p', { class: 'small', role: 'status' });
    const bar = el('div', { class: 'progress hidden' }, el('i'));
    const matchBox = el('div', { class: 'match hidden' });
    const previewBox = el('div', { class: 'hidden', style: 'margin-top:16px' });
    const drop = el('div', { class: 'drop' }, el('p', { text: 'Перетащите файл сюда или выберите его' }), el('div', { style: 'margin-top:10px' }, file));

    main.replaceChildren(
      head('Загрузка из файла', 'Excel, CSV, PDF или фото. Перед записью всё можно проверить; незнакомые названия система уточнит у вас.'),
      el('div', { class: 'imp-grid' },
        el('div', { class: 'panel imp-card' },
          el('label', { class: 'field' }, el('span', { text: 'Что загружаем' }), target),
          el('div', { class: 'choices' },
            el('label', { class: 'choice' }, modeDirect, el('span', { text: 'По заголовкам колонок' })),
            el('label', { class: 'choice', title: meta.aiReady ? '' : 'ИИ не настроен: в таблице меню → Настройки → Настройки ИИ' }, modeAi, el('span', { text: 'Через ИИ' }))),
          hint),
        el('div', { class: 'panel imp-card' }, drop, sheetWrap, paste)),
      el('div', { class: 'toolbar', style: 'margin-top:16px' }, go,
        el('label', { class: 'check', style: 'border:0;background:none;padding:0' }, direct, el('span', { text: 'Записать сразу, без проверки' }))),
      bar, status, matchBox, previewBox);

    const setStatus = (t, bad) => { status.textContent = t || ''; status.className = 'small' + (bad ? ' err' : ''); };
    const setProgress = (i, n) => { bar.classList.toggle('hidden', !n); bar.firstChild.style.width = n ? Math.round(i / n * 100) + '%' : '0'; };

    function updateHint() {
      const v = target.value;
      if (v === 'auto') {
        hint.textContent = 'ИИ перенесёт все строки и сам разложит их: склад, выдано сотрудникам, мебель по местам.';
        modeAi.checked = true; modeDirect.disabled = true;
      } else {
        const t = meta.targets[v];
        hint.textContent = t.hint + ' Колонки: ' + t.fields.map(f => f.label).join(', ') + '.';
        if (!bin) { modeDirect.disabled = false; modeDirect.checked = true; }
      }
      matchBox.classList.add('hidden'); previewBox.classList.add('hidden'); pending = null;
    }
    target.addEventListener('change', updateHint);
    updateHint();

    // ---------- Файл ----------
    ['dragover', 'dragenter'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
    file.addEventListener('change', () => { if (file.files[0]) readFile(file.files[0]); });

    function readFile(f) {
      wb = null; bin = null; pdfRows = null;
      const reader = new FileReader();
      const aiOnly = AI_TYPES.indexOf(f.type) >= 0 || /\.(pdf|png|jpe?g|webp)$/i.test(f.name);
      if (aiOnly) {
        if (!meta.aiReady) { setStatus('PDF и фото разбирает только ИИ, а он не настроен (в таблице: Настройки → Настройки ИИ).', true); return; }
        if (f.size > 15 * 1024 * 1024) { setStatus('Файл больше 15 МБ — разбейте его на части.', true); return; }
        reader.onload = async e => {
          const url = String(e.target.result);
          const isPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
          bin = { name: f.name, mimeType: f.type || (isPdf ? 'application/pdf' : 'image/jpeg'), data: url.slice(url.indexOf(',') + 1), pages: 1 };
          modeAi.checked = true; modeDirect.disabled = true; sheetWrap.classList.add('hidden');
          if (isPdf && window.pdfjsLib) {
            setStatus('Читаю PDF…');
            try {
              const res = await readPdfText(bin.data);
              bin.pages = res.pages;
              if (res.rows.length > 1) { pdfRows = res.rows; setStatus('PDF прочитан: ' + res.pages + ' стр., ' + res.rows.length + ' строк. ИИ разберёт их частями.'); return; }
            } catch (err) { console.warn(err); }
            setStatus('В PDF нет текста (похоже на скан) — ИИ прочитает его как изображение.');
            return;
          }
          setStatus('Файл загружен: ' + f.name + '. Его разберёт ИИ.');
        };
        reader.readAsDataURL(f);
        return;
      }
      if (target.value !== 'auto') modeDirect.disabled = false;
      reader.onload = e => {
        try {
          wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          sheet.replaceChildren(...wb.SheetNames.map(n => el('option', { value: n, text: n })));
          sheetWrap.classList.toggle('hidden', wb.SheetNames.length < 2);
          setStatus('Файл прочитан: ' + f.name);
        } catch (err) { setStatus('Не удалось прочитать файл: ' + err.message, true); }
      };
      reader.readAsArrayBuffer(f);
    }

    async function readPdfText(base64) {
      const raw = atob(base64), bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
      const rows = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const content = await (await doc.getPage(p)).getTextContent();
        const lines = [];
        content.items.forEach(it => {
          const str = String(it.str || ''); if (!str.trim()) return;
          const x = it.transform[4], y = it.transform[5];
          let line = lines.find(l => Math.abs(l.y - y) < 3);
          if (!line) { line = { y, parts: [] }; lines.push(line); }
          line.parts.push({ x, end: x + (it.width || 0), str });
        });
        lines.sort((a, b) => b.y - a.y).forEach(l => {
          l.parts.sort((a, b) => a.x - b.x);
          const cells = []; let prevEnd = null;
          l.parts.forEach(pt => {
            if (prevEnd === null || pt.x - prevEnd > 6) cells.push(pt.str.trim());
            else cells[cells.length - 1] += (pt.x - prevEnd > 1 ? ' ' : '') + pt.str.trim();
            prevEnd = pt.end;
          });
          rows.push(cells);
        });
      }
      return { pages: doc.numPages, rows };
    }

    function getRows() {
      const p = paste.value.trim();
      if (p) {
        const sep = p.indexOf('\t') >= 0 ? '\t' : (p.indexOf(';') >= 0 ? ';' : ',');
        return p.split(/\r?\n/).map(l => l.split(sep));
      }
      if (!wb) return null;
      return XLSX.utils.sheet_to_json(wb.Sheets[sheet.value || wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    }

    // ---------- Разбор ----------
    go.addEventListener('click', async () => {
      const pasted = paste.value.trim();
      const useBin = bin && !pasted && !pdfRows;
      const rows = useBin ? null : (pdfRows && !pasted ? pdfRows : getRows());
      if (!useBin && !rows) { setStatus('Выберите файл или вставьте строки.', true); return; }
      const t = target.value;
      const mode = (useBin || (pdfRows && !pasted) || t === 'auto') ? 'ai' : (modeAi.checked ? 'ai' : 'direct');
      go.disabled = true; matchBox.classList.add('hidden'); previewBox.classList.add('hidden');
      try {
        if (mode !== 'ai') {
          setStatus('Сопоставляю колонки…');
          handleResult(await api('importPreview', { target: t, mode, rows }));
          return;
        }
        const parts = [];
        if (useBin) {
          const n = Math.max(1, bin.pages || 1);
          for (let p = 1; p <= n; p += 3) parts.push({ range: { from: p, to: Math.min(n, p + 2) } });
        } else {
          const header = rows[0], body = rows.slice(1), SIZE = 40;
          for (let i = 0; i < body.length; i += SIZE) parts.push({ rows: [header].concat(body.slice(i, i + SIZE)) });
          if (!parts.length) parts.push({ rows });
        }
        const raw = {};
        for (let i = 0; i < parts.length; i++) {
          setStatus('ИИ разбирает часть ' + (i + 1) + ' из ' + parts.length + '…');
          setProgress(i, parts.length);
          let res, tries = 0;
          while (true) {
            try { res = await api('importChunk', { target: t, rows: parts[i].rows || null, file: useBin ? bin : null, range: parts[i].range || null }); break; }
            catch (e) {
              if (++tries >= 3) throw new Error('Часть ' + (i + 1) + ' из ' + parts.length + ': ' + e.message);
              setStatus('Часть ' + (i + 1) + ': ошибка, пробую ещё раз…');
              await new Promise(r => setTimeout(r, 5000));
            }
          }
          Object.keys(res).forEach(k => { raw[k] = (raw[k] || []).concat(res[k]); });
        }
        setProgress(1, 1);
        setStatus('Проверяю результат и ищу незнакомые названия…');
        handleResult(await api('importFinalize', { raw }));
      } catch (e) {
        setStatus(e.message, true);
      } finally { go.disabled = false; setProgress(0, 0); }
    });

    function handleResult(res) {
      if (!res || !res.sections || !Object.keys(res.sections).length) { setStatus('В файле не нашлось строк с предметами.', true); return; }
      if (res.unknown && res.unknown.length) { askMatches(res); return; }
      proceed(res);
    }

    // ---------- «Уточните позиции» ----------
    function askMatches(res) {
      pending = res;
      const tbody = el('tbody', {}, ...res.unknown.map(u => {
        const sel = el('select', { 'data-name': u.name, 'aria-label': 'Что такое «' + u.name + '» на складе' });
        if (u.suggestion) sel.append(el('option', { value: u.suggestion, text: u.suggestion + ' — предложено ИИ' }));
        sel.append(el('option', { value: '', text: '+ Создать новую позицию «' + u.name + '»' }));
        const others = res.catalog.filter(n => n !== u.suggestion);
        if (others.length) sel.append(el('optgroup', { label: 'Другие позиции склада' }, ...others.map(n => el('option', { value: n, text: n }))));
        sel.value = u.suggestion || '';
        return el('tr', {}, el('td', {}, el('b', { text: u.name })), el('td', { class: 'n', text: String(u.count) }),
          el('td', {}, sel, u.suggestion ? el('div', { class: 'ai-hint', text: 'ИИ считает, что это одно и то же — проверьте' }) : null));
      }));
      const remember = el('input', { type: 'checkbox', checked: true });
      const apply = el('button', { class: 'btn', type: 'button', text: 'Применить и продолжить' });
      apply.addEventListener('click', () => {
        const choice = {};
        tbody.querySelectorAll('select').forEach(s => { if (s.value) choice[norm(s.dataset.name)] = s.value; });
        const mem = {};
        Object.keys(pending.sections).forEach(k => pending.sections[k].forEach(r => {
          if (!r.unknown) return;
          const key = 'name' in r.data ? 'name' : 'item';
          const src = r.data[key], to = choice[norm(src)];
          if (!to) return;
          r.data[key] = to;
          r.flags = r.flags.filter(f => f !== 'новая позиция').concat('сопоставлено: ' + src + ' → ' + to);
          r.unknown = false;
          mem[src] = to;
        }));
        if (remember.checked && Object.keys(mem).length) api('saveAliases', { map: mem }).catch(e => console.warn(e));
        const r = pending; pending = null;
        matchBox.classList.add('hidden');
        proceed(r);
      });
      matchBox.replaceChildren(
        el('h2', { text: 'Уточните позиции' }),
        el('p', { class: 'muted small', text: 'Этих названий нет на складе. Выберите, чему они соответствуют, — или создайте новую позицию.' }),
        el('div', { class: 'table-wrap' }, el('table', {},
          el('thead', {}, el('tr', {}, el('th', { text: 'В файле' }), el('th', { class: 'n', text: 'Строк' }), el('th', { text: 'Что это на складе' }))), tbody)),
        el('div', { class: 'toolbar', style: 'justify-content:space-between;margin:0' },
          el('label', { class: 'check', style: 'border:0;background:none;padding:0' }, remember, el('span', { text: 'Запомнить выбор для следующих загрузок' })), apply));
      matchBox.classList.remove('hidden');
      setStatus('Найдено незнакомых названий: ' + res.unknown.length + '. Уточните их — затем продолжим.');
    }

    // ---------- Проверка и запись ----------
    function proceed(res) {
      if (!direct.checked) { renderPreview(res.sections); return; }
      const jobs = [], rest = {};
      Object.keys(res.sections).forEach(k => {
        const good = res.sections[k].filter(r => r.ok).map(r => ({ data: r.data }));
        const bad = res.sections[k].filter(r => !r.ok);
        if (good.length) jobs.push({ target: k, rows: good });
        if (bad.length) rest[k] = bad;
      });
      commit(jobs, () => { if (Object.keys(rest).length) renderPreview(rest, true); });
    }

    function renderPreview(sections, leftovers) {
      let total = 0, warn = 0, off = 0;
      const blocks = Object.keys(sections).map(key => {
        const t = meta.targets[key], records = sections[key];
        const tbody = el('tbody', {}, ...records.map(r => {
          total++; if (!r.ok) off++; else if (r.flags.length) warn++;
          return el('tr', { class: !r.ok ? 'bad' : (r.flags.length ? 'warn' : '') },
            el('td', {}, el('input', { type: 'checkbox', checked: r.ok, 'aria-label': 'Записать строку' })),
            ...t.fields.map(f => el('td', { contenteditable: 'true', 'data-key': f.key, text: r.data[f.key] == null ? '' : String(r.data[f.key]) })),
            el('td', { class: 'flags small', text: r.flags.join('; ') }));
        }));
        return el('section', { style: 'margin-bottom:16px', 'data-target': key },
          el('h3', { style: 'margin-bottom:8px', text: t.title + ': ' + records.length }),
          el('div', { class: 'table-wrap' }, el('table', {},
            el('thead', {}, el('tr', {}, el('th', {}), ...t.fields.map(f => el('th', { text: f.label })), el('th', { text: 'Замечания' }))), tbody)));
      });
      const btn = el('button', { class: 'btn', type: 'button', text: 'Записать отмеченные' });
      btn.addEventListener('click', () => {
        const jobs = [];
        previewBox.querySelectorAll('section[data-target]').forEach(sec => {
          const rows = [];
          sec.querySelectorAll('tbody tr').forEach(tr => {
            if (!tr.querySelector('input[type=checkbox]').checked) return;
            const data = {};
            tr.querySelectorAll('td[data-key]').forEach(td => { data[td.dataset.key] = td.textContent.trim(); });
            rows.push({ data });
          });
          if (rows.length) jobs.push({ target: sec.dataset.target, rows });
        });
        if (!jobs.length) { setStatus('Не отмечено ни одной строки.', true); return; }
        commit(jobs, () => previewBox.classList.add('hidden'));
      });
      previewBox.replaceChildren(...blocks,
        el('div', { class: 'toolbar', style: 'justify-content:space-between' },
          el('span', { class: 'muted small', text: 'Строк: ' + total + '. С замечаниями: ' + warn + '. Не отмечены (нет главного поля): ' + off + ' — допишите и отметьте вручную.' }), btn));
      previewBox.classList.remove('hidden');
      setStatus(leftovers ? 'Ниже строки без названия, этажа или логина — допишите, отметьте и запишите.' : 'Проверьте данные. Ячейки можно исправить прямо в таблице.');
    }

    async function commit(jobs, after) {
      if (!jobs.length) { setStatus('В файле не нашлось строк, которые можно записать сразу.', true); if (after) after(); return; }
      go.disabled = true;
      setStatus('Записываю…');
      const done = [];
      try {
        for (const job of jobs) {
          const res = await api('importCommit', { target: job.target, records: job.rows });
          done.push(meta.targets[job.target].title + ': ' + res.message + '.');
        }
        setStatus('Готово. ' + done.join(' '));
        toast('Данные записаны в таблицу');
        if (after) after();
      } catch (e) { setStatus(e.message, true); }
      finally { go.disabled = false; }
    }
  }

  window.TMCImport = { render };
})();
