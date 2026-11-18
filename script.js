/* =========================================================
   Computer Boss Davao — Booking Script
   ========================================================= */

/* ---------------------------------------------------------
   1) CONFIGURATION  —  replace with your Supabase keys
   --------------------------------------------------------- */
const SUPABASE_URL      = 'https://bnwqksbiunkxwmhxyphz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_pbFrpxwZKnNDCgB39eZp2g_Aa-5wffn';
const STORAGE_BUCKET    = 'booking-screenshots';   // public bucket name

const MAX_SLOTS_PER_DAY = 5;   // slots per day
const CLOSED_WEEKDAY    = 0;   // 0 = Sunday (store is closed)
const MAX_FILE_MB       = 5;   // max screenshot size

/* ---------------------------------------------------------
   2) SUPABASE CLIENT  (+ demo fallback)
   --------------------------------------------------------- */
const supabaseReady =
  !SUPABASE_URL.includes('YOUR-PROJECT-REF') &&
  !SUPABASE_ANON_KEY.includes('YOUR_SUPABASE');

const db = supabaseReady ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/* -------- Demo mode helpers (localStorage) -------- */
const DEMO_KEY = 'cb_demo_bookings';
const demoAll  = () => { try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || []; } catch { return []; } };
const demoSave = (rows) => localStorage.setItem(DEMO_KEY, JSON.stringify(rows));

/* ---------------------------------------------------------
   3) DOM REFERENCES
   --------------------------------------------------------- */
const calendarGrid    = document.getElementById('calendarGrid');
const monthLabel      = document.getElementById('monthLabel');
const prevMonthBtn    = document.getElementById('prevMonth');
const nextMonthBtn    = document.getElementById('nextMonth');

const bookingForm     = document.getElementById('bookingForm');
const formFields      = document.getElementById('formFields');
const formCard        = document.getElementById('formCard');
const submitBtn       = document.getElementById('submitBtn');

const selectedDateBar = document.getElementById('selectedDateBar');
const selectedDateText= document.getElementById('selectedDateText');

const fileInput       = document.getElementById('screenshot');
const fileDrop        = document.getElementById('fileDrop');
const fileNameEl      = document.getElementById('fileName');

const successPanel    = document.getElementById('successPanel');
const newBookingBtn   = document.getElementById('newBookingBtn');
const refNoEl         = document.getElementById('refNo');
const refDateEl       = document.getElementById('refDate');
const refNameEl       = document.getElementById('refName');

const demoBanner      = document.getElementById('demoBanner');
const toastEl         = document.getElementById('toast');
document.getElementById('year').textContent = new Date().getFullYear();

/* ---------------------------------------------------------
   4) STATE & UTILITIES
   --------------------------------------------------------- */
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

const today = new Date();
const todayStr = toDateStr(today.getFullYear(), today.getMonth(), today.getDate());

let viewYear  = today.getFullYear();
let viewMonth = today.getMonth();       // 0-indexed
let counts    = {};                     // { 'YYYY-MM-DD': bookedCount }
let selectedDate = null;                // 'YYYY-MM-DD'
let toastTimer;

function pad(n) { return String(n).padStart(2, '0'); }

function toDateStr(y, m, d) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

function formatLong(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}

function showToast(message, type = 'info') {
  toastEl.textContent = message;
  toastEl.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 4500);
}

function setFormEnabled(enabled) {
  formFields.disabled = !enabled;
  formCard.classList.toggle('locked', !enabled);
}

function setSubmitting(on) {
  submitBtn.disabled = on;
  submitBtn.textContent = on ? 'Submitting…' : 'Confirm Booking';
}

/* ---------------------------------------------------------
   5) DATA LAYER
   --------------------------------------------------------- */

/**
 * Loads the number of bookings per date for a given month.
 * Uses the secure RPC `get_slot_counts` so anonymous visitors
 * can never read personal details.
 */
async function loadCounts(year, month) {
  counts = {};

  const first = toDateStr(year, month, 1);
  const last  = toDateStr(year, month, new Date(year, month + 1, 0).getDate());

  if (!db) {
    demoAll().forEach((b) => {
      if (b.status !== 'cancelled') {
        counts[b.booking_date] = (counts[b.booking_date] || 0) + 1;
      }
    });
    return;
  }

  const { data, error } = await db.rpc('get_slot_counts', {
    start_date: first,
    end_date: last
  });

  if (error) {
    console.error('loadCounts:', error);
    showToast('Unable to load availability. Please refresh.', 'error');
    return;
  }

  (data || []).forEach((row) => {
    counts[row.booking_date] = Number(row.total);
  });
}

/** Returns how many bookings already exist for one date. */
async function getBookedCount(dateStr) {
  if (!db) {
    return demoAll().filter((b) => b.booking_date === dateStr && b.status !== 'cancelled').length;
  }

  const { data, error } = await db.rpc('get_slot_counts', {
    start_date: dateStr,
    end_date: dateStr
  });

  if (error) throw error;
  return data && data.length ? Number(data[0].total) : 0;
}

/** Uploads the screenshot and returns its public URL (or null). */
async function uploadScreenshot(file) {
  if (!file) return null;

  const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  if (!db) {
    // Demo mode: return a temporary local object URL
    return URL.createObjectURL(file);
  }

  const { error } = await db.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false });

  if (error) throw error;

  const { data } = db.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Inserts a booking row and returns the created record. */
async function insertBooking(payload) {
  if (!db) {
    const record = {
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      ...payload,
      created_at: new Date().toISOString()
    };
    const rows = demoAll();
    rows.push(record);
    demoSave(rows);
    return record;
  }

  const { data, error } = await db
    .from('bookings')
    .insert([payload])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/* ---------------------------------------------------------
   6) CALENDAR RENDERING
   --------------------------------------------------------- */
async function refreshMonth() {
  await loadCounts(viewYear, viewMonth);
  renderCalendar();
  updateMonthNav();
}

function updateMonthNav() {
  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();
  prevMonthBtn.disabled = isCurrentMonth;
}

function renderCalendar() {
  monthLabel.textContent = `${MONTHS[viewMonth]} ${viewYear}`;
  calendarGrid.innerHTML = '';

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth  = new Date(viewYear, viewMonth + 1, 0).getDate();

  // Leading blank cells
  for (let i = 0; i < firstWeekday; i++) {
    const blank = document.createElement('div');
    blank.className = 'day empty';
    calendarGrid.appendChild(blank);
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const ds       = toDateStr(viewYear, viewMonth, d);
    const weekday  = new Date(viewYear, viewMonth, d).getDay();
    const booked   = counts[ds] || 0;
    const remaining= MAX_SLOTS_PER_DAY - booked;

    const isSunday = weekday === CLOSED_WEEKDAY;
    const isPast   = ds < todayStr;
    const isFull   = remaining <= 0;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day';
    btn.dataset.date = ds;

    let sub = '';
    if (isSunday) {
      btn.classList.add('closed');
      sub = 'Closed';
    } else if (isPast) {
      btn.classList.add('past');
    } else if (isFull) {
      btn.classList.add('full');
      sub = 'Full';
    } else {
      sub = `${remaining} slot${remaining === 1 ? '' : 's'}`;
    }

    btn.innerHTML = `<span class="num">${d}</span><span class="slots">${sub}</span>`;

    btn.disabled = isSunday || isPast || isFull;

    if (ds === selectedDate) btn.classList.add('selected');

    if (!btn.disabled) {
      btn.addEventListener('click', () => selectDate(ds, remaining));
    }

    calendarGrid.appendChild(btn);
  }
}

function selectDate(dateStr, remaining) {
  selectedDate = dateStr;

  selectedDateText.textContent =
    `${formatLong(dateStr)} — ${remaining} of ${MAX_SLOTS_PER_DAY} slots available`;
  selectedDateBar.classList.add('has-date');

  setFormEnabled(true);
  renderCalendar();

  // Scroll the form into view on small screens
  if (window.innerWidth < 900) {
    formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/* Month navigation */
prevMonthBtn.addEventListener('click', async () => {
  if (viewYear === today.getFullYear() && viewMonth === today.getMonth()) return;
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  await refreshMonth();
});

nextMonthBtn.addEventListener('click', async () => {
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  await refreshMonth();
});

/* ---------------------------------------------------------
   7) FILE UPLOAD UI
   --------------------------------------------------------- */
fileDrop.addEventListener('click', () => fileInput.click());

fileDrop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];

  if (!file) {
    fileDrop.classList.remove('has-file');
    fileNameEl.textContent = 'Click to upload a photo or screenshot (max 5MB)';
    return;
  }

  if (!file.type.startsWith('image/')) {
    showToast('Please upload an image file only.', 'error');
    fileInput.value = '';
    return;
  }

  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    showToast(`Image must be under ${MAX_FILE_MB}MB.`, 'error');
    fileInput.value = '';
    return;
  }

  fileDrop.classList.add('has-file');
  fileNameEl.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
});

/* ---------------------------------------------------------
   8) FORM SUBMISSION
   --------------------------------------------------------- */
bookingForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!selectedDate) {
    showToast('Please select a date on the calendar first.', 'error');
    return;
  }

  if (!bookingForm.checkValidity()) {
    bookingForm.reportValidity();
    return;
  }

  setSubmitting(true);

  try {
    /* --- Re-check availability right before saving --- */
    const currentCount = await getBookedCount(selectedDate);
    if (currentCount >= MAX_SLOTS_PER_DAY) {
      showToast('Sorry, this date just became fully booked. Please choose another day.', 'error');
      setSubmitting(false);
      await refreshMonth();
      return;
    }

    /* --- Optional screenshot upload --- */
    const file = fileInput.files[0];
    const screenshotUrl = await uploadScreenshot(file);

    /* --- Build payload --- */
    const payload = {
      name:                document.getElementById('name').value.trim(),
      contact_no:          document.getElementById('contact').value.trim(),
      address:             document.getElementById('address').value.trim(),
      facebook_link:       document.getElementById('facebook').value.trim() || null,

      /* NEW warranty fields */
      warranty_slip_no:    document.getElementById('warrantyNo').value.trim() || null,
      warranty_slip_name:  document.getElementById('warrantyName').value.trim() || null,

      problem_description: document.getElementById('problem').value.trim(),
      screenshot_url:      screenshotUrl,
      booking_date:        selectedDate,
      status:              'pending'
    };

    /* --- Save --- */
    const saved = await insertBooking(payload);

    /* --- Show success --- */
    showSuccess(saved || payload);
    await refreshMonth();

  } catch (err) {
    console.error('Booking failed:', err);
    showToast(err.message || 'Something went wrong. Please try again.', 'error');
    setSubmitting(false);
  }
});

function showSuccess(record) {
  const ref = record.id
    ? String(record.id).replace(/-/g, '').slice(0, 8).toUpperCase()
    : 'CB-' + Date.now().toString().slice(-6);

  refNoEl.textContent   = `CB-${ref}`;
  refDateEl.textContent = formatLong(record.booking_date);
  refNameEl.textContent = record.name;

  bookingForm.classList.add('hidden');
  successPanel.classList.remove('hidden');

  setSubmitting(false);
  showToast('Booking submitted successfully!', 'success');
}

/* ---------------------------------------------------------
   9) RESET / NEW BOOKING
   --------------------------------------------------------- */
newBookingBtn.addEventListener('click', async () => {
  bookingForm.reset();
  fileInput.value = '';
  fileDrop.classList.remove('has-file');
  fileNameEl.textContent = 'Click to upload a photo or screenshot (max 5MB)';

  selectedDate = null;
  selectedDateText.textContent = 'No date selected — pick a day on the calendar.';
  selectedDateBar.classList.remove('has-date');

  setFormEnabled(false);
  setSubmitting(false);

  successPanel.classList.add('hidden');
  bookingForm.classList.remove('hidden');

  await refreshMonth();
});

/* ---------------------------------------------------------
   10) INIT
   --------------------------------------------------------- */
(async function init() {
  if (!db) {
    demoBanner.hidden = false;
    console.warn('[Computer Boss Davao] Supabase is not configured — running in DEMO mode.');
  }

  setFormEnabled(false);
  await refreshMonth();
})();
