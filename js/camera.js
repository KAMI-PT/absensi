/**
 * ============================================================
 * camera.js — Kamera Selfie & Face Detection Module
 * WFH Attendance System | GitHub Pages Edition
 * face-api.js dimuat dari CDN
 * ============================================================
 */
var CameraModule = {
  video       : null,
  canvas      : null,
  faceCanvas  : null,
  stream      : null,
  capturedB64 : null,
  faceDetected: false,
  detectionInterval: null,
  modelsLoaded: false,
  MODEL_URL   : 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights',

  /* ── INIT ─────────────────────────────────────────── */
  init: function () {
    this.video      = document.getElementById('camera-video');
    this.canvas     = document.getElementById('photo-canvas');
    this.faceCanvas = document.getElementById('face-canvas');
    if (!this.video) return;

    var self = this;
    this._loadModels().then(function () {
      self._startCamera();
    });
  },

  /* ── LOAD MODELS ──────────────────────────────────── */
  _loadModels: function () {
    var self = this;
    var fill = document.getElementById('model-loading-fill');
    var text = document.getElementById('model-status-text');

    function upd(pct, msg) {
      if (fill) fill.style.width = pct + '%';
      if (text) text.textContent = msg;
    }

    return new Promise(function (resolve) {
      if (typeof faceapi === 'undefined') {
        upd(100, 'AI tidak tersedia — mode manual');
        resolve();
        return;
      }

      upd(10, 'Memuat AI model...');
      faceapi.nets.tinyFaceDetector.loadFromUri(self.MODEL_URL)
        .then(function () {
          upd(70, 'Memuat landmark model...');
          return faceapi.nets.faceLandmark68TinyNet.loadFromUri(self.MODEL_URL);
        })
        .then(function () {
          upd(100, 'AI siap ✓');
          self.modelsLoaded = true;
          setTimeout(function () {
            var w = document.getElementById('model-status-wrap');
            if (w) w.style.display = 'none';
          }, 1500);
          resolve();
        })
        .catch(function (err) {
          console.warn('face-api load failed:', err.message);
          upd(100, 'Mode manual (tanpa AI)');
          resolve();
        });
    });
  },

  /* ── START CAMERA ─────────────────────────────────── */
  _startCamera: function () {
    var self    = this;
    var overlay = document.getElementById('camera-init-overlay');
    var scanLine = document.getElementById('scan-line');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (overlay) overlay.innerHTML = '<div style="color:#EF9A9A;padding:20px;text-align:center;">📷 Browser tidak mendukung kamera.</div>';
      return;
    }

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    })
    .then(function (stream) {
      self.stream = stream;
      self.video.srcObject = stream;
      self.video.onloadedmetadata = function () {
        self.video.play();
        if (overlay) overlay.style.display = 'none';
        if (scanLine) scanLine.classList.add('active');
        if (self.modelsLoaded) {
          self._startDetectionLoop();
        } else {
          self._setFaceStatus('detected'); // fallback: anggap ok
        }
      };
    })
    .catch(function (err) {
      console.error('Camera error:', err);
      if (overlay) {
        overlay.innerHTML =
          '<div style="text-align:center;padding:20px;">' +
          '<div style="font-size:2rem;">📷</div>' +
          '<div style="color:rgba(255,255,255,0.8);font-size:0.82rem;margin:10px 0;">Kamera tidak dapat diakses.<br>Izinkan akses kamera di browser.</div>' +
          '<button class="btn btn-secondary btn-sm" onclick="CameraModule.init()">Coba Lagi</button>' +
          '</div>';
      }
    });
  },

  /* ── DETECTION LOOP ───────────────────────────────── */
  _startDetectionLoop: function () {
    var self = this;
    if (self.detectionInterval) clearInterval(self.detectionInterval);
    self.detectionInterval = setInterval(function () {
      self._detectFace();
    }, 900);
  },

  _detectFace: function () {
    var self = this;
    if (!this.video || this.video.paused || !this.modelsLoaded || typeof faceapi === 'undefined') return;

    faceapi
      .detectSingleFace(this.video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 }))
      .withFaceLandmarks(true)
      .then(function (det) {
        if (det) {
          self.faceDetected = true;
          self._setFaceStatus('detected');
          self._drawFaceBox(det);
        } else {
          self.faceDetected = false;
          self._setFaceStatus('not-detected');
          self._clearFaceCanvas();
        }
      })
      .catch(function () {});
  },

  _drawFaceBox: function (detection) {
    if (!this.faceCanvas) return;
    var dims   = faceapi.matchDimensions(this.faceCanvas, this.video, true);
    var resized = faceapi.resizeResults(detection, dims);
    var ctx    = this.faceCanvas.getContext('2d');
    ctx.clearRect(0, 0, this.faceCanvas.width, this.faceCanvas.height);

    var box = resized.detection.box;
    var p   = 14;
    ctx.strokeStyle = 'rgba(116,198,157,0.85)';
    ctx.lineWidth   = 2.5;
    ctx.shadowColor = 'rgba(116,198,157,0.5)';
    ctx.shadowBlur  = 8;

    [[box.x - p, box.y - p, 1, 1], [box.x + box.width + p, box.y - p, -1, 1],
     [box.x - p, box.y + box.height + p, 1, -1], [box.x + box.width + p, box.y + box.height + p, -1, -1]]
      .forEach(function (c) {
        ctx.beginPath();
        ctx.moveTo(c[0] + c[2] * 22, c[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.lineTo(c[0], c[1] + c[3] * 22);
        ctx.stroke();
      });
  },

  _clearFaceCanvas: function () {
    if (!this.faceCanvas) return;
    this.faceCanvas.getContext('2d').clearRect(0, 0, this.faceCanvas.width, this.faceCanvas.height);
  },

  _setFaceStatus: function (status) {
    var indicator = document.getElementById('face-indicator');
    if (!indicator) return;
    var map = {
      detecting     : ['detecting',     '👁️ MENDETEKSI...'],
      detected      : ['detected',      '✓ WAJAH TERDETEKSI'],
      'not-detected': ['not-detected',  '✗ TIDAK TERDETEKSI'],
    };
    var s = map[status] || map.detecting;
    indicator.className = 'face-indicator ' + s[0];
    indicator.innerHTML = '<span class="face-dot"></span>' + s[1];
  },

  /* ── CAPTURE ──────────────────────────────────────── */
  capture: function () {
    var self = this;
    if (!this.stream) { Toast.error('Kamera belum aktif.'); return null; }
    if (this.modelsLoaded && !this.faceDetected) {
      Toast.error('Wajah tidak terdeteksi. Posisikan wajah di kamera.');
      return null;
    }

    // Flash
    var flash = document.getElementById('capture-flash');
    if (flash) {
      flash.classList.add('flash');
      setTimeout(function () { flash.classList.remove('flash'); }, 130);
    }

    var canvas = this.canvas || document.createElement('canvas');
    canvas.width  = this.video.videoWidth  || 640;
    canvas.height = this.video.videoHeight || 480;
    var ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(this.video, 0, 0);

    // Compress
    var maxW       = 800;
    var ratio      = Math.min(1, maxW / canvas.width);
    var compressed = document.createElement('canvas');
    compressed.width  = Math.round(canvas.width  * ratio);
    compressed.height = Math.round(canvas.height * ratio);
    compressed.getContext('2d').drawImage(canvas, 0, 0, compressed.width, compressed.height);

    this.capturedB64 = compressed.toDataURL('image/jpeg', 0.80);

    // Show preview
    var preview = document.getElementById('photo-preview');
    var wrap    = document.getElementById('photo-preview-wrap');
    if (preview) preview.src = this.capturedB64;
    if (wrap)    wrap.style.display = 'flex';

    var videoWrap = document.getElementById('camera-frame-wrap');
    if (videoWrap) videoWrap.style.display = 'none';

    this._stopDetection();
    return this.capturedB64;
  },

  retake: function () {
    this.capturedB64 = null;
    var wrap     = document.getElementById('photo-preview-wrap');
    var videoWrap = document.getElementById('camera-frame-wrap');
    if (wrap)     wrap.style.display = 'none';
    if (videoWrap) videoWrap.style.display = 'block';

    if (!this.stream) { this._startCamera(); }
    else if (this.modelsLoaded) { this._startDetectionLoop(); }
    else { this._setFaceStatus('detected'); }
  },

  stop: function () {
    this._stopDetection();
    if (this.stream) {
      this.stream.getTracks().forEach(function (t) { t.stop(); });
      this.stream = null;
    }
  },

  _stopDetection: function () {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
      this.detectionInterval = null;
    }
  },

  getBase64: function ()  { return this.capturedB64; },
  hasPhoto:  function ()  { return !!this.capturedB64; },
  isFaceOK:  function ()  { return !this.modelsLoaded || this.faceDetected; },
};
