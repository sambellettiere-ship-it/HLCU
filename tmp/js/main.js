'use strict';

/* ── Active nav link ── */
(function markActiveNav() {
  const page = document.body.dataset.page;
  if (!page) return;
  const links = document.querySelectorAll('.nav__links a');
  links.forEach(a => {
    if (a.dataset.page === page) a.classList.add('active');
  });
})();

/* ── Mobile hamburger ── */
(function initHamburger() {
  const btn = document.querySelector('.nav__hamburger');
  const menu = document.querySelector('.nav__links');
  if (!btn || !menu) return;

  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    menu.classList.toggle('open', !open);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menu.classList.contains('open')) {
      btn.setAttribute('aria-expanded', 'false');
      menu.classList.remove('open');
      btn.focus();
    }
  });

  document.addEventListener('click', e => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) {
      btn.setAttribute('aria-expanded', 'false');
      menu.classList.remove('open');
    }
  });
})();

/* ── Scroll-reveal ── */
(function initReveal() {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('is-visible'));
    return;
  }
  const pref = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (pref) {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('is-visible'));
    return;
  }
  const obs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
})();

/* ── Calendar generation ── */
(async function initCalendar() {
  const grid = document.getElementById('cal-grid');
  const titleEl = document.getElementById('cal-title');
  if (!grid || !titleEl) return;

  /* Fetch admin-created events */
  const customByDate = {};
  let customList = [];
  try {
    const res = await fetch('/api/events', { cache: 'no-store' });
    if (res.ok) {
      customList = await res.json();
      customList.forEach(ev => {
        if (!customByDate[ev.date]) customByDate[ev.date] = [];
        customByDate[ev.date].push(ev);
      });
    }
  } catch { /* non-fatal */ }

  /* Fetch admin-created recurring rules */
  let recurringList = [];
  try {
    const res = await fetch('/api/recurring', { cache: 'no-store' });
    if (res.ok) recurringList = await res.json();
  } catch { /* non-fatal */ }

  renderUpcoming(customList);

  let viewYear, viewMonth;
  const today = new Date();

  function pill(type, label, time, clickData) {
    const safeLabel = escapeHtml(label);
    const timeHtml = time ? `<span class="ev-time">${escapeHtml(time)}</span>` : '';
    if (clickData) {
      const json = JSON.stringify(clickData).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
      return `<span class="cal-event-pill ${escapeHtml(type)} clickable" data-event='${json}' tabindex="0" role="button">${safeLabel}${timeHtml}</span>`;
    }
    return `<span class="cal-event-pill ${escapeHtml(type)}">${safeLabel}${timeHtml}</span>`;
  }

  function ruleMatches(rule, year, month, day, dow, daysInMonth) {
    if (rule.dayOfWeek !== dow) return false;
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (rule.startDate && dateKey < rule.startDate) return false;
    if (rule.endDate && dateKey > rule.endDate) return false;
    if (rule.frequency === 'weekly') return true;
    if (rule.frequency === 'monthly_nth') {
      if (rule.nth === -1) {
        return day + 7 > daysInMonth;
      }
      const occurrence = Math.floor((day - 1) / 7) + 1;
      return occurrence === rule.nth;
    }
    return false;
  }

  function render(year, month) {
    viewYear = year;
    viewMonth = month;

    const monthNames = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
                        'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
    titleEl.textContent = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const dows = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    let html = dows.map(d => `<div class="calendar-grid__dow">${d}</div>`).join('');

    for (let i = 0; i < firstDay; i++) html += `<div class="cal-day empty"></div>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month, d).getDay();
      const isToday = year === today.getFullYear() && month === today.getMonth() && d === today.getDate();
      let classes = 'cal-day' + (isToday ? ' today' : '');
      let pills = '';

      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      if (customByDate[dateKey]) {
        customByDate[dateKey].forEach(ev => {
          const timeStr = ev.startTime ? (ev.endTime ? `${ev.startTime}–${ev.endTime}` : ev.startTime) : '';
          pills += pill(ev.type, ev.title, timeStr, ev);
        });
      }

      recurringList.forEach(rule => {
        if (!ruleMatches(rule, year, month, d, dow, daysInMonth)) return;
        const timeStr = rule.startTime ? (rule.endTime ? `${rule.startTime}–${rule.endTime}` : rule.startTime) : '';
        pills += pill(rule.type, rule.title, timeStr, {
          title: rule.title, type: rule.type, date: dateKey,
          startTime: rule.startTime || '', endTime: rule.endTime || '',
          description: rule.description || '',
          _info: true,
        });
      });

      html += `<div class="${classes}"><div class="cal-day__num">${d}</div>${pills}</div>`;
    }

    const total = firstDay + daysInMonth;
    const rem = total % 7;
    if (rem !== 0) for (let i = 0; i < 7 - rem; i++) html += `<div class="cal-day empty"></div>`;

    grid.innerHTML = html;

    /* Attach click handlers to custom event pills */
    grid.querySelectorAll('.cal-event-pill.clickable').forEach(el => {
      el.addEventListener('click', () => {
        try { openEventModal(JSON.parse(el.dataset.event)); } catch {}
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          try { openEventModal(JSON.parse(el.dataset.event)); } catch {}
        }
      });
    });
  }

  render(today.getFullYear(), today.getMonth());

  document.getElementById('cal-prev')?.addEventListener('click', () => {
    let m = viewMonth - 1, y = viewYear;
    if (m < 0) { m = 11; y--; }
    render(y, m);
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    let m = viewMonth + 1, y = viewYear;
    if (m > 11) { m = 0; y++; }
    render(y, m);
  });
})();

/* ── Upcoming events list (admin-created) ── */
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatUpcomingDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dows = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return { dow: dows[date.getDay()], month: months[m - 1], day: d, year: y };
}

function renderUpcoming(list) {
  const section = document.getElementById('upcoming-section');
  const container = document.getElementById('upcoming-list');
  if (!section || !container) return;

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const upcoming = list
    .filter(ev => ev.date >= todayKey)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 12);

  if (!upcoming.length) { section.hidden = true; return; }
  section.hidden = false;

  container.innerHTML = upcoming.map(ev => {
    const fd = formatUpcomingDate(ev.date);
    const timeStr = ev.startTime ? (ev.endTime ? `${ev.startTime}–${ev.endTime}` : ev.startTime) : '';
    const dataAttr = `data-event='${JSON.stringify(ev).replace(/'/g, '&#39;')}'`;
    return `
      <button class="upcoming-card" type="button" ${dataAttr}>
        <div class="upcoming-card__date">
          <span class="day">${fd.day}</span>
          <span class="month">${fd.month}</span>
          <span class="dow">${fd.dow}</span>
        </div>
        <div class="upcoming-card__info">
          <div class="upcoming-card__head">
            <h3>${escapeHtml(ev.title)}</h3>
            <span class="badge ${escapeHtml(ev.type)}">${escapeHtml(ev.type)}</span>
          </div>
          ${ev.description ? `<p class="upcoming-card__desc">${escapeHtml(ev.description)}</p>` : ''}
          ${timeStr ? `<div class="upcoming-card__meta"><span>🕒 ${escapeHtml(timeStr)}</span></div>` : ''}
        </div>
        <span class="upcoming-card__cta">Details →</span>
      </button>`;
  }).join('');

  container.querySelectorAll('.upcoming-card').forEach(el => {
    el.addEventListener('click', () => {
      try { openEventModal(JSON.parse(el.dataset.event)); } catch {}
    });
  });
}

/* ── Event detail modal ── */
function openEventModal(ev) {
  const modal = document.getElementById('event-modal');
  if (!modal) return;

  const badge = document.getElementById('modal-badge');
  badge.textContent = ev.type;
  badge.className = 'event-modal__badge ' + ev.type;

  document.getElementById('modal-title').textContent = ev.title;

  const dateParts = ev.date.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dows = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dateObj = new Date(+dateParts[0], +dateParts[1] - 1, +dateParts[2]);
  const dateFormatted = `${dows[dateObj.getDay()]}, ${months[+dateParts[1] - 1]} ${+dateParts[2]}`;
  document.getElementById('modal-date').textContent = dateFormatted;

  const timeStr = ev.startTime ? (ev.endTime ? `${ev.startTime}–${ev.endTime}` : ev.startTime) : '';
  const timeStat = document.getElementById('modal-time-stat');
  if (timeStr) {
    document.getElementById('modal-time').textContent = timeStr;
    timeStat.hidden = false;
  } else {
    timeStat.hidden = true;
  }

  const descWrap = document.getElementById('modal-desc-wrap');
  const descEl = document.getElementById('modal-desc');
  if (ev.description) {
    descEl.textContent = ev.description;
    descWrap.hidden = false;
  } else {
    descWrap.hidden = true;
  }

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeEventModal() {
  const modal = document.getElementById('event-modal');
  if (modal) modal.hidden = true;
  document.body.style.overflow = '';
}

document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('event-modal');
  if (modal) {
    modal.addEventListener('click', e => { if (e.target === modal) closeEventModal(); });
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeEventModal(); });

/* ── Contact form ── */
(function initContactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('form-error');
    if (errEl) errEl.style.display = 'none';

    const body = {
      name: document.getElementById('f-name')?.value.trim() || '',
      email: document.getElementById('f-email')?.value.trim() || '',
      subject: document.getElementById('f-subject')?.value || '',
      message: document.getElementById('f-msg')?.value.trim() || '',
    };
    if (document.getElementById('f-booking-date')) {
      body.bookingDate = document.getElementById('f-booking-date').value;
      body.bookingTime = document.getElementById('f-booking-time').value.trim();
      body.bookingGuests = document.getElementById('f-booking-guests').value;
      body.bookingType = document.getElementById('f-booking-type').value;
    }

    const submitBtn = form.querySelector('[type=submit]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        form.style.display = 'none';
        const success = document.getElementById('form-success');
        if (success) success.style.display = 'block';
      } else {
        const data = await res.json().catch(() => ({}));
        if (errEl) {
          errEl.textContent = data.error || 'Something went wrong. Please try again or call us directly.';
          errEl.style.display = 'block';
        }
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send Message'; }
      }
    } catch {
      if (errEl) {
        errEl.textContent = 'Could not connect. Please call us at 217-418-7404 or email Hiddenlevelcu@gmail.com.';
        errEl.style.display = 'block';
      }
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send Message'; }
    }
  });
})();

/* ── Toggle booking fields on contact form ── */
function toggleBookingFields() {
  const subject = document.getElementById('f-subject')?.value;
  const fields = document.getElementById('booking-fields');
  if (fields) fields.style.display = subject === 'booking' ? 'block' : 'none';
}
