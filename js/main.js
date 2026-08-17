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
          id: rule.id + '_' + dateKey,
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

let currentModalEventId = null;
let isRegistered = false;

async function checkRegistration(eventId) {
  const token = localStorage.getItem('hl_user_token');
  const btn = document.getElementById('modal-register-btn');
  const msg = document.getElementById('modal-registration-msg');
  if(!btn) return;
  msg.style.display = 'none';
  if (!token) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = 'inline-block';
  btn.textContent = '...';
  try {
    const res = await fetch('/api/registrations/' + encodeURIComponent(eventId), {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if(res.ok) {
      const data = await res.json();
      isRegistered = data.registered;
      btn.textContent = isRegistered ? 'Unregister from Event' : 'Register for Event';
      btn.style.color = isRegistered ? '#f2132d' : 'var(--cyan)';
      btn.style.borderColor = isRegistered ? '#f2132d' : 'var(--cyan)';
    } else {
      btn.style.display = 'none';
    }
  } catch(e) {
    btn.style.display = 'none';
  }
}

async function toggleRegistration() {
  if(!currentModalEventId) return;
  const token = localStorage.getItem('hl_user_token');
  const btn = document.getElementById('modal-register-btn');
  const msg = document.getElementById('modal-registration-msg');
  if(!token) return;
  btn.disabled = true;
  try {
    const res = await fetch('/api/registrations/' + encodeURIComponent(currentModalEventId), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ register: !isRegistered })
    });
    if(res.ok) {
      const data = await res.json();
      isRegistered = data.registered;
      btn.textContent = isRegistered ? 'Unregister from Event' : 'Register for Event';
      btn.style.color = isRegistered ? '#f2132d' : 'var(--cyan)';
      btn.style.borderColor = isRegistered ? '#f2132d' : 'var(--cyan)';
      msg.textContent = isRegistered ? 'Successfully registered! Please pay in person at the store.' : 'Successfully unregistered.';
      msg.className = 'msg success';
      msg.style.display = 'block';
    } else {
      throw new Error();
    }
  } catch(e) {
    msg.textContent = 'An error occurred.';
    msg.className = 'msg error';
    msg.style.display = 'block';
  }
  btn.disabled = false;
  setTimeout(() => { if(msg) msg.style.display = 'none'; }, 5000);
}

/* ── Event detail modal ── */
function openEventModal(ev) {
  const modal = document.getElementById('event-modal');
  if (!modal) return;
  
  currentModalEventId = ev.id || (ev.title + '_' + ev.date).replace(/[^a-zA-Z0-9]/g, '');
  checkRegistration(currentModalEventId);

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

/* ── Contact form (Formspree AJAX) ── */
(function initContactForm() {
  const FORMSPREE_ENDPOINT = 'https://formspree.io/f/xkodbeyj';
  const form = document.getElementById('contact-form');
  if (!form) return;

  const subjectLabels = {
    general: 'General Question',
    booking: 'Private Booking',
    membership: 'Membership',
    event: 'Event Info',
    other: 'Other',
  };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('form-error');
    const submitBtn = form.querySelector('[type=submit]');
    if (errEl) errEl.style.display = 'none';

    const showError = msg => {
      if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send Message'; }
    };

    // Honeypot: bots fill hidden fields; a real user leaves it empty.
    const gotcha = form.querySelector('[name="_gotcha"]');
    if (gotcha && gotcha.value) return; // silently drop spam

    const subjectVal = document.getElementById('f-subject')?.value || '';
    const subjectLabel = subjectLabels[subjectVal] || 'Contact Form';
    const name = document.getElementById('f-name')?.value.trim() || '';

    const body = {
      name,
      email: document.getElementById('f-email')?.value.trim() || '',
      subject: subjectLabel,
      message: document.getElementById('f-msg')?.value.trim() || '',
      // Formspree special field: sets the notification email's subject line.
      _subject: `[Hidden Level] ${subjectLabel}${name ? ' from ' + name : ''}`,
    };

    // Only send booking details for private-booking enquiries.
    if (subjectVal === 'booking') {
      body.bookingDate = document.getElementById('f-booking-date')?.value || '';
      body.bookingTime = document.getElementById('f-booking-time')?.value.trim() || '';
      body.bookingGuests = document.getElementById('f-booking-guests')?.value || '';
      body.bookingType = document.getElementById('f-booking-type')?.value || '';
    }

    if (!body.name || !body.email || !body.message) {
      showError('Please fill in your name, email, and message.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      showError('Please enter a valid email address.');
      return;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }

    try {
      const res = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        form.style.display = 'none';
        const success = document.getElementById('form-success');
        if (success) success.style.display = 'block';
      } else {
        const data = await res.json().catch(() => ({}));
        const msg = Array.isArray(data.errors) && data.errors.length
          ? data.errors.map(er => er.message).join(', ')
          : 'Something went wrong. Please try again or call us directly.';
        showError(msg);
      }
    } catch {
      showError('Could not connect. Please call us at 217-418-7404 or email Hiddenlevelcu@gmail.com.');
    }
  });
})();

/* ── Toggle booking fields on contact form ── */
function toggleBookingFields() {
  const subject = document.getElementById('f-subject')?.value;
  const fields = document.getElementById('booking-fields');
  if (fields) fields.style.display = subject === 'booking' ? 'block' : 'none';
}

/* ── Hero establishment photo backdrop ── */
(function initHeroBackdrop() {
  const media = document.getElementById('hero-media');
  const hero = media ? media.closest('.hero') : null;
  if (!media || !hero) return;

  const urls = (Array.isArray(window.HERO_BG_IMAGES) ? window.HERO_BG_IMAGES : [])
    .map(u => String(u).trim())
    .filter(Boolean);
  if (!urls.length) return; // keep the default neon background

  // Build a slide layer per photo.
  const slides = urls.map((url, i) => {
    const slide = document.createElement('div');
    slide.className = 'hero__slide' + (i === 0 ? ' is-active' : '');
    slide.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
    media.appendChild(slide);
    return slide;
  });

  // Only reveal the darkening overlay once the first image actually loads,
  // so a broken URL never leaves the headline floating on a black box.
  const first = new Image();
  first.onload = () => hero.classList.add('has-media');
  first.onerror = () => { slides[0].remove(); };
  first.src = urls[0];

  if (slides.length < 2) return; // nothing to rotate

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return; // show a single still image

  let idx = 0;
  setInterval(() => {
    slides[idx].classList.remove('is-active');
    idx = (idx + 1) % slides.length;
    slides[idx].classList.add('is-active');
  }, 6000);
})();

/* ── Dynamic Hours Badge ── */
(function initHoursBadge() {
  const textEl = document.getElementById('hero-hours-text');
  const dotEl = document.getElementById('hero-hours-dot');
  if (!textEl || !dotEl) return;

  const dayOfWeek = new Date().getDay(); // 0 is Sunday, 1 is Monday
  
  if (dayOfWeek === 0 || dayOfWeek === 1) { // Sunday or Monday
    textEl.textContent = 'Closed Today · Urbana, IL';
    dotEl.style.background = 'var(--text-muted)'; 
    dotEl.style.boxShadow = 'none';
    dotEl.style.animation = 'none';
  } else {
    // Tue-Sat
    textEl.textContent = 'Open Today: 6–10 PM · Urbana, IL';
    // Keeping default pulse animation and cyan color since the prompt asks for business hours updates.
    // Resetting just in case.
    dotEl.style.background = ''; 
    dotEl.style.boxShadow = '';
    dotEl.style.animation = '';
  }
})();
