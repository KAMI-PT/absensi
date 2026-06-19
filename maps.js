/**
 * ============================================================
 * maps.js — GPS & Leaflet.js / OpenStreetMap Module
 * WFH Attendance System | GitHub Pages Edition
 * Leaflet dimuat dari CDN
 * ============================================================
 */
var MapsModule = {
  map        : null,
  marker     : null,
  _accCircle : null,
  latitude   : null,
  longitude  : null,
  accuracy   : null,
  lokasiText : '',
  gpsValid   : false,

  /* ── INIT MAP ─────────────────────────────────────── */
  initMap: function () {
    if (this.map) return;
    if (typeof L === 'undefined') {
      console.warn('Leaflet belum dimuat.');
      return;
    }
    this.map = L.map('mini-map', {
      zoomControl       : true,
      attributionControl: false,
      scrollWheelZoom   : false,
    }).setView([-6.9, 107.5], 9);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom    : 19,
    }).addTo(this.map);
  },

  /* ── GET LOCATION ─────────────────────────────────── */
  getLocation: function () {
    var self = this;
    this._setStatus('searching');
    this._setInfoLoading();

    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        self._setStatus('error');
        reject(new Error('Geolocation tidak didukung browser ini.'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        function (pos) {
          self.latitude  = pos.coords.latitude;
          self.longitude = pos.coords.longitude;
          self.accuracy  = Math.round(pos.coords.accuracy);
          self.gpsValid  = true;
          self._updateMapPin();
          self._reverseGeocode();
          self._updateInfoUI();
          self._setStatus('found');
          resolve({ lat: self.latitude, lng: self.longitude, acc: self.accuracy });
        },
        function (err) {
          self._setStatus('error');
          var msgs = { 1: 'Izin GPS ditolak.', 2: 'Lokasi tidak tersedia.', 3: 'Timeout GPS.' };
          reject(new Error(msgs[err.code] || 'GPS error.'));
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  },

  /* ── MAP PIN ──────────────────────────────────────── */
  _updateMapPin: function () {
    if (!this.map || typeof L === 'undefined') return;
    var latLng = [this.latitude, this.longitude];
    var self   = this;

    var icon = L.divIcon({
      className: '',
      html: '<div style="width:12px;height:12px;background:linear-gradient(135deg,#2D6A4F,#74C69D);border-radius:50%;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.35);"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7],
    });

    if (this.marker) {
      this.marker.setLatLng(latLng);
    } else {
      this.marker = L.marker(latLng, { icon: icon }).addTo(this.map);
    }

    if (this._accCircle) { this._accCircle.remove(); }
    this._accCircle = L.circle(latLng, {
      radius: this.accuracy, color: '#40916C',
      fillColor: '#74C69D', fillOpacity: 0.12, weight: 1.5,
    }).addTo(this.map);

    this.marker.bindPopup(
      '<b>Lokasi Anda</b><br>' +
      this.latitude.toFixed(6) + ', ' + this.longitude.toFixed(6) + '<br>' +
      '<small>Akurasi: ±' + this.accuracy + 'm</small>'
    ).openPopup();

    this.map.setView(latLng, 16, { animate: true });
  },

  /* ── REVERSE GEOCODE ──────────────────────────────── */
  _reverseGeocode: function () {
    var self = this;
    var url  = 'https://nominatim.openstreetmap.org/reverse?lat=' +
               this.latitude + '&lon=' + this.longitude +
               '&format=json&addressdetails=1&accept-language=id';
    fetch(url, { headers: { 'Accept-Language': 'id' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.display_name) {
          self.lokasiText = data.display_name;
          var el = document.getElementById('lokasi-full-text');
          if (el) el.textContent = self.lokasiText;
        }
      })
      .catch(function () {
        self.lokasiText = self.latitude.toFixed(6) + ', ' + self.longitude.toFixed(6);
      });
  },

  /* ── UPDATE UI ────────────────────────────────────── */
  _updateInfoUI: function () {
    var latEl   = document.getElementById('gps-lat');
    var lngEl   = document.getElementById('gps-lng');
    var accEl   = document.getElementById('gps-acc');
    var accFill  = document.getElementById('accuracy-fill');
    var accLabel = document.getElementById('accuracy-label');

    if (latEl) latEl.textContent = this.latitude.toFixed(6);
    if (lngEl) lngEl.textContent = this.longitude.toFixed(6);
    if (accEl) accEl.textContent = '±' + this.accuracy + ' m';

    if (accFill && this.accuracy !== null) {
      var pct = Math.max(10, 100 - Math.min(this.accuracy, 100));
      var clr = this.accuracy < 15 ? '#4CAF50' : this.accuracy < 50 ? '#FF9800' : '#F44336';
      accFill.style.width           = pct + '%';
      accFill.style.backgroundColor = clr;
      if (accLabel) {
        accLabel.textContent = this.accuracy < 15 ? 'Sangat Baik' : this.accuracy < 50 ? 'Cukup' : 'Rendah';
      }
    }
  },

  _setInfoLoading: function () {
    ['gps-lat', 'gps-lng', 'gps-acc'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = '<small style="color:var(--clr-gray-500);">...</small>';
    });
  },

  _setStatus: function (state) {
    var chip = document.getElementById('gps-status-chip');
    if (!chip) return;
    var map = {
      searching: ['searching', '📡 MENCARI GPS...'],
      found    : ['found',     '✓ GPS AKTIF'],
      error    : ['error',     '✗ GPS ERROR'],
    };
    var s = map[state] || map.searching;
    chip.className   = 'gps-status-chip ' + s[0];
    chip.textContent = s[1];
  },

  /* ── GETTERS ──────────────────────────────────────── */
  getLat   : function () { return this.latitude; },
  getLng   : function () { return this.longitude; },
  getAcc   : function () { return this.accuracy; },
  getLokasi: function () { return this.lokasiText; },
  isValid  : function () { return this.gpsValid; },
};
