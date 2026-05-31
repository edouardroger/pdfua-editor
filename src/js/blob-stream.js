/**
 * blob-stream.js
 * Implémentation navigateur de l'interface Writable Node.js,
 * suffisante pour PDFKit standalone.
 *
 * PDFKit appelle sur le stream :
 *   .on(event, fn) / .once(event, fn) / .removeListener(event, fn)
 *   .emit(event, ...args)
 *   .write(chunk) / .end([chunk]) / .destroy()
 *
 * L'appelant (editor.js) appelle :
 *   stream.on('finish', fn) / stream.on('error', fn)
 *   stream.toBlobURL(mimeType)
 */
(function (global) {
  'use strict';

  function BlobStream() {
    this._chunks = [];
    this._listeners = {};
    this._blob = null;
    this.writable = true;
  }

  /* ── EventEmitter minimal ── */

  BlobStream.prototype._getList = function (event) {
    if (!this._listeners[event]) this._listeners[event] = [];
    return this._listeners[event];
  };

  BlobStream.prototype.on = function (event, fn) {
    this._getList(event).push(fn);
    return this;
  };

  BlobStream.prototype.once = function (event, fn) {
    var self = this;
    function wrapper() {
      fn.apply(this, arguments);
      self.removeListener(event, wrapper);
    }
    wrapper._orig = fn;
    return this.on(event, wrapper);
  };

  BlobStream.prototype.removeListener = function (event, fn) {
    var list = this._listeners[event];
    if (!list) return this;
    this._listeners[event] = list.filter(function (f) {
      return f !== fn && f._orig !== fn;
    });
    return this;
  };

  BlobStream.prototype.emit = function (event) {
    var args = Array.prototype.slice.call(arguments, 1);
    var list = (this._listeners[event] || []).slice();
    list.forEach(function (fn) { fn.apply(null, args); });
    return this;
  };

  /* ── Interface Writable ── */

  BlobStream.prototype.write = function (chunk) {
    if (chunk == null) return true;
    if (chunk instanceof Uint8Array) {
      this._chunks.push(chunk);
    } else if (chunk instanceof ArrayBuffer) {
      this._chunks.push(new Uint8Array(chunk));
    } else if (Array.isArray(chunk)) {
      this._chunks.push(new Uint8Array(chunk));
    } else if (typeof chunk === 'string') {
      var bytes = new Uint8Array(chunk.length);
      for (var i = 0; i < chunk.length; i++) {
        bytes[i] = chunk.charCodeAt(i) & 0xff;
      }
      this._chunks.push(bytes);
    } else {
      try { this._chunks.push(new Uint8Array(chunk)); } catch (e) {
        console.warn('BlobStream.write: type inconnu', typeof chunk);
      }
    }
    return true;
  };

  BlobStream.prototype.end = function (chunk) {
    if (chunk) this.write(chunk);
    var self = this;
    setTimeout(function () {
      self._blob = new Blob(self._chunks, { type: 'application/pdf' });
      self._chunks = [];
      self.emit('finish');
      self.emit('close');
    }, 0);
    return this;
  };

  BlobStream.prototype.destroy = function () {
    this._chunks = [];
    this.writable = false;
  };

  /* ── API blob-stream ── */

  BlobStream.prototype.toBlobURL = function (mimeType) {
    if (!this._blob) throw new Error('BlobStream: end() pas encore appelé');
    var blob = mimeType ? new Blob([this._blob], { type: mimeType }) : this._blob;
    return URL.createObjectURL(blob);
  };

  BlobStream.prototype.toBlob = function () {
    return this._blob;
  };

  /* ── Export global ── */
  global.blobStream = function () {
    return new BlobStream();
  };

}(typeof window !== 'undefined' ? window : this));
