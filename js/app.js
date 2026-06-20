/**
 * ============================================================
 * app.js — Shared Utilities & Fetch-based API
 * WFH Attendance System | GitHub Pages Edition
 * Menggantikan google.script.run dengan fetch() ke GAS REST API
 * ============================================================
 */

/* ============================================================
   JSONP HELPER
   Memuat data dari GAS lewat tag <script> — TIDAK melalui fetch(),
   sehingga sepenuhnya menghindari CORS. Ini dibutuhkan karena
   fetch() cross-origin ke GAS Web App sering terblokir CORS akibat
   redirect internal script.google.com -> script.googleusercontent.com,
   meskipun endpoint-nya valid saat dibuka langsung di browser.
   ============================================================ */
let _jsonpCounter = 0;

function jsonpRequest(baseUrl, params, timeoutMs) {
  timeoutMs = timeoutMs || 15000;
  return new Promise(function (resolve, reject) {
    _jsonpCounter++;
    var cbName = '_wfh_jsonp_cb_' + Date.now() + '_' + _jsonpCounter;
    var script = document.createElement('script');
    var timer;

    function cleanup() {
      clearTimeout(timer);
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function (data) {
      cleanup();
      resolve(data);
    };

    timer = setTimeout(function () {
      cleanup();
      reject(new Error('Request timeout — server tidak merespons dalam ' + (timeoutMs/1000) + 's.'));
    }, timeoutMs);

    var qs = [];
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v !== undefined && v !== null && v !== '') {
        qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      }
    });
    qs.push('callback=' + cbName);

    var sep = baseUrl.indexOf('?') === -1 ? '?' : '&';
    script.src = baseUrl + sep + qs.join('&');
    script.onerror = function () {
      cleanup();
      reject(new Error('Gagal memuat script dari GAS. Cek URL di config.js (harus diakhiri /exec) dan koneksi internet.'));
    };
    document.head.appendChild(script);
  });
}

/* ============================================================
   GAS REST API WRAPPER
   Menggantikan google.script.run sepenuhnya
   ============================================================ */
const API = {
  /**
   * Validasi konfigurasi URL sebelum request apapun
   */
  _checkUrl() {
    if (!window.GAS_URL || typeof window.GAS_URL !== 'string') {
      throw new Error('GAS_URL tidak terdefinisi. Cek apakah js/config.js berhasil dimuat (lihat tab Network di DevTools).');
    }
    if (window.GAS_URL.indexOf('PASTE_WEB_APP_URL') !== -1) {
      throw new Error('URL GAS di config.js masih placeholder. Ganti dengan Web App URL asli yang diakhiri /exec.');
    }
    if (window.GAS_URL.indexOf('/exec') === -1) {
      throw new Error('URL GAS di config.js harus diakhiri "/exec" (bukan "/dev" atau lainnya).');
    }
  },

  /**
   * GET request → untuk operasi baca (login, dashboard, filter, histori)
   * Menggunakan JSONP (script tag) — bukan fetch() — supaya tidak terkena CORS.
   */
  async get(action, params = {}) {
    this._checkUrl();
    var allParams = Object.assign({ action: action }, params);
    var result = await jsonpRequest(window.GAS_URL, allParams);
    if (!result || typeof result !== 'object') {
      throw new Error('Respon server tidak valid.');
    }
    return result;
  },

  /**
   * POST request → untuk operasi tulis (simpan absensi, ada foto base64)
   * JSONP tidak bisa membawa payload besar, jadi tetap pakai fetch()
   * dengan Content-Type sederhana (x-www-form-urlencoded) supaya
   * dikirim sebagai "simple request" tanpa CORS preflight.
   */
  async post(action, data = {}) {
    this._checkUrl();
    const form = new URLSearchParams();
    form.append('action', action);
    form.append('payload', JSON.stringify(data));

    let res;
    try {
      res = await fetch(window.GAS_URL, {
        method : 'POST',
        body   : form,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        redirect: 'follow',
      });
    } catch (networkErr) {
      // Fetch gagal total (CORS terblokir / tidak ada koneksi)
      throw new Error('Gagal terhubung ke server (kemungkinan CORS atau koneksi). Detail: ' + networkErr.message);
    }

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (parseErr) {
      throw new Error('Server tidak mengembalikan JSON yang valid. Kemungkinan deployment GAS bermasalah. Cuplikan respon: ' + text.substring(0, 150));
    }
    if (!res.ok && !json) throw new Error('HTTP ' + res.status);
    return json;
  },

  /**
   * Unified call — otomatis pilih GET atau POST
   */
  async call(fnName, data = {}) {
    const writeFns = ['simpanAbsensi'];
    if (writeFns.includes(fnName)) {
      return this.post(fnName, data);
    }
    // Untuk GET, flatten object sebagai URL params
    if (typeof data === 'object' && !Array.isArray(data)) {
      return this.get(fnName, data);
    }
    // Untuk call dengan satu argumen primitif (misal loginUser(nik))
    return this.get(fnName, { arg: data });
  },

  /**
   * Login khusus (dengan parameter nik)
   */
  async loginUser(nik) {
    return this.get('login', { nik });
  },

  /**
   * Simpan absensi (POST karena ada base64 foto besar)
   */
  async simpanAbsensi(absensiData) {
    return this.post('simpanAbsensi', absensiData);
  },

  /**
   * Dashboard data
   */
  async getDashboardData() {
    return this.get('dashboard');
  },

  /**
   * Filter absensi
   */
  async filterAbsensi(params) {
    return this.get('filter', params);
  },

  /**
   * Histori satu karyawan
   */
  async getHistoriKaryawan(nik) {
    return this.get('histori', { nik });
  },

  /**
   * Self-test koneksi ke GAS — dipakai untuk diagnosis cepat
   */
  async ping() {
    return this.get('ping');
  },
};

/* ============================================================
   SESSION MANAGER
   ============================================================ */
const Session = {
  KEY    : 'wfh_session',
  TIMEOUT: 8 * 60 * 60 * 1000, // 8 jam

  save(userData) {
    const session = Object.assign({}, userData, { savedAt: Date.now() });
    try {
      sessionStorage.setItem(this.KEY, JSON.stringify(session));
      if (localStorage.getItem('wfh_remember') === '1') {
        localStorage.setItem(this.KEY, JSON.stringify(session));
      }
    } catch (e) { console.warn('Session save failed:', e); }
  },

  load() {
    try {
      var raw = sessionStorage.getItem(this.KEY) || localStorage.getItem(this.KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (Date.now() - s.savedAt > this.TIMEOUT) { this.clear(); return null; }
      return s;
    } catch (e) { return null; }
  },

  clear() {
    try {
      sessionStorage.removeItem(this.KEY);
      localStorage.removeItem(this.KEY);
    } catch (e) {}
  },

  isLoggedIn() { return !!this.load(); },

  getUser() { return this.load(); },
};

/* ============================================================
   URL HELPER — deteksi base URL dari window.location
   ============================================================ */
function getBaseUrl() {
  var href = window.location.href;
  var idx  = href.lastIndexOf('/');
  return href.substring(0, idx + 1);
}

/* ============================================================
   NAVIGASI ANTAR HALAMAN (GitHub Pages)
   ============================================================ */
function navigateTo(page) {
  window.location.href = getBaseUrl() + page + '.html';
}

/* ============================================================
   TOAST NOTIFICATION SYSTEM
   ============================================================ */
var Toast = (function () {
  var container = null;

  function init() {
    if (!container) {
      container = document.getElementById('toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
      }
    }
  }

  function show(message, type, duration) {
    type     = type     || 'info';
    duration = duration || 4000;
    init();
    var icons  = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    var toast  = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.innerHTML = '<span class="toast-icon">' + (icons[type] || icons.info) + '</span><span>' + message + '</span>';
    container.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('hide');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 350);
    }, duration);
  }

  return {
    show   : show,
    success: function (m, d) { show(m, 'success', d); },
    error  : function (m, d) { show(m, 'error',   d); },
    warning: function (m, d) { show(m, 'warning', d); },
    info   : function (m, d) { show(m, 'info',    d); },
  };
})();

/* ============================================================
   LOADING OVERLAY
   ============================================================ */
var Loading = (function () {
  var overlay = null;

  return {
    show: function (msg) {
      msg = msg || 'Memproses...';
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;';
        document.body.appendChild(overlay);
      }
      overlay.innerHTML = '<div class="spinner spinner-lg"></div><p style="color:white;font-family:var(--font-display);letter-spacing:0.1em;font-size:0.9rem;">' + msg + '</p>';
      overlay.style.display = 'flex';
    },
    hide: function () {
      if (overlay) overlay.style.display = 'none';
    },
  };
})();

/* ============================================================
   DARK MODE MANAGER
   ============================================================ */
var DarkMode = {
  KEY: 'wfh_dark',

  init: function () {
    try {
      var saved      = localStorage.getItem(this.KEY);
      var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      var hr         = new Date().getHours();
      var autoNight  = (hr >= 18 || hr < 6);

      if (saved === 'dark' || (!saved && (prefersDark || autoNight))) {
        document.documentElement.setAttribute('data-theme', 'dark');
        this._setIcon('☀️');
      }
    } catch (e) {}
  },

  toggle: function () {
    var current = document.documentElement.getAttribute('data-theme');
    var next    = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(this.KEY, next); } catch (e) {}
    this._setIcon(next === 'dark' ? '☀️' : '🌙');
  },

  _setIcon: function (icon) {
    var btn = document.getElementById('dark-toggle');
    if (btn) btn.textContent = icon;
  },
};

/* ============================================================
   DIGITAL CLOCK
   ============================================================ */
function startDigitalClock(elementId) {
  var el = document.getElementById(elementId || 'digital-clock');
  if (!el) return;
  function tick() {
    var now = new Date();
    var h   = String(now.getHours()).padStart(2, '0');
    var m   = String(now.getMinutes()).padStart(2, '0');
    var s   = String(now.getSeconds()).padStart(2, '0');
    el.textContent = h + ':' + m + ':' + s;
  }
  tick();
  setInterval(tick, 1000);
}

/* ============================================================
   RIPPLE EFFECT
   ============================================================ */
function addRipple(e) {
  var btn  = e.currentTarget;
  var rect = btn.getBoundingClientRect();
  var r    = document.createElement('span');
  r.className  = 'ripple-effect';
  r.style.left = (e.clientX - rect.left) + 'px';
  r.style.top  = (e.clientY - rect.top)  + 'px';
  btn.appendChild(r);
  setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 700);
}

/* ============================================================
   ESCAPE HTML (XSS protection)
   ============================================================ */
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ============================================================
   SIDEBAR TOGGLE (mobile)
   ============================================================ */
function toggleSidebarMenu() {
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('show');
}

function closeSidebarMenu() {
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('show');
}

/* ============================================================
   EXPORT UTILITIES
   ============================================================ */
var Export = {
  toCSV: function (rows, headers, filename) {
    var csvRows = [headers];
    rows.forEach(function (r) {
      csvRows.push(headers.map(function (h) {
        return '"' + (String(r[h] || r[h.toLowerCase()] || '')).replace(/"/g, '""') + '"';
      }));
    });
    var csv  = csvRows.map(function (r) { return r.join(','); }).join('\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename || 'export.csv';
    link.click();
  },
};

/* ============================================================
   AUTO INIT on DOM Ready
   ============================================================ */
document.addEventListener('DOMContentLoaded', function () {
  // Dark mode
  DarkMode.init();

  // Ripple on buttons
  document.querySelectorAll('.btn').forEach(function (btn) {
    btn.addEventListener('click', addRipple);
  });

  // Auto logout idle (30 menit)
  var idleTimer;
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (Session.isLoggedIn()) {
        Session.clear();
        Toast.warning('Sesi berakhir karena tidak aktif.');
        setTimeout(function () { navigateTo('login'); }, 2000);
      }
    }, 30 * 60 * 1000);
  }
  ['mousemove', 'keydown', 'touchstart', 'click'].forEach(function (ev) {
    document.addEventListener(ev, resetIdle, { passive: true });
  });
  resetIdle();
});
