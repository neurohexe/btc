/**
 * Офисы сайта ТМЦ. Один офис = одна таблица со своим скриптом.
 *
 * id   — короткое имя латиницей, оно попадает в ссылку формы: zayavka.html?office=almaty
 * name — как офис называется на сайте
 * api  — ссылка развёртывания скрипта этого офиса (Развёртывание → Управление развёртываниями → URL, заканчивается на /exec)
 *
 * Новый офис: скопируйте строку, поменяйте id, name и api.
 */
window.OFFICES = [
  {
    id: 'almaty',
    name: 'Большой Алматинский Офис',
    api: 'https://script.google.com/macros/s/https://script.google.com/macros/s/AKfycbwzkecuP03wwLJaPxF-np3cehQwEF4zs7FmMeBuXMUJ5Xg1RHiXIurEdx-LTC1bPmqR/exec/exec'
  }
];
