/* Связь сайта со скриптом офиса (Google Apps Script). Без заголовка Content-Type —
   так браузер не делает предварительный запрос, и Apps Script принимает его напрямую. */
(function () {
  const offices = window.OFFICES || [];

  function office(id) {
    return offices.find(o => o.id === id) || null;
  }

  async function call(officeId, action, body) {
    const o = office(officeId);
    if (!o) throw new Error('Офис не найден. Проверьте ссылку.');
    if (/ВСТАВЬТЕ/.test(o.api)) throw new Error('Для офиса «' + o.name + '» не указан адрес скрипта (файл offices.js).');
    let res;
    try {
      res = await fetch(o.api, { method: 'POST', body: JSON.stringify(Object.assign({ action }, body || {})) });
    } catch (e) {
      throw new Error('Нет связи с таблицей офиса. Проверьте интернет и попробуйте ещё раз.');
    }
    let j;
    try { j = await res.json(); } catch (e) {
      throw new Error('Таблица офиса ответила не так, как ожидалось. Проверьте, что скрипт развёрнут с доступом «Все».');
    }
    if (!j.ok) { const err = new Error(j.error || 'Ошибка'); err.auth = !!j.auth; throw err; }
    return j.data;
  }

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* приватный режим */ } }
  };

  /** Небольшие помощники для разметки. */
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k in e && typeof v !== 'string') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    kids.flat().forEach(c => { if (c != null && c !== false) e.append(c.nodeType ? c : String(c)); });
    return e;
  }

  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  function fmtDate(v, withTime) {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d)) return String(v);
    const p = n => String(n).padStart(2, '0');
    const s = p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
    return withTime ? s + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) : s;
  }
  function fmtDay(v) {
    const d = new Date(v);
    return isNaN(d) ? '' : d.getDate() + ' ' + MONTHS[d.getMonth()];
  }
  function plural(n, one, few, many) {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return one;
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
    return many;
  }
  const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

  window.TMC = { offices, office, call, store, el, fmtDate, fmtDay, plural, norm };
})();
