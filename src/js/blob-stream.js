/**
 * blob-stream.js
 * Implémentation suffisante pour PDFKit standalone.
 *
 * PDFKit appelle sur le flux :
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

  /* ── Classe BlobStream — ES6 ── */

  class BlobStream {
    constructor() {
      this._chunks = [];
      this._listeners = new Map(); // Map<event, fn[]> — O(1) lookup
      this._blob = null;
      this.writable = true;
    }

    /* ── EventEmitter minimal ── */

    _getList(event) {
      if (!this._listeners.has(event)) this._listeners.set(event, []);
      return this._listeners.get(event);
    }

    on(event, fn) {
      this._getList(event).push(fn);
      return this;
    }

    once(event, fn) {
      const wrapper = (...args) => {
        fn.apply(null, args);
        this.removeListener(event, wrapper);
      };
      wrapper._orig = fn;
      return this.on(event, wrapper);
    }

    removeListener(event, fn) {
      const list = this._listeners.get(event);
      if (!list) return this;
      this._listeners.set(event, list.filter(f => f !== fn && f._orig !== fn));
      return this;
    }

    emit(event, ...args) {
      const list = this._listeners.get(event);
      if (list) list.slice().forEach(fn => fn.apply(null, args));
      return this;
    }

    /* ── Interface Writable ── */

    write(chunk) {
      if (chunk == null) return true;
      // Fast path : PDFKit envoie presque toujours des Uint8Array
      if (chunk instanceof Uint8Array) {
        this._chunks.push(chunk);
      } else if (ArrayBuffer.isView(chunk)) {
        // Couvre Int8Array, Float32Array, etc. — vue partagée → copie propre
        this._chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      } else if (chunk instanceof ArrayBuffer) {
        this._chunks.push(new Uint8Array(chunk));
      } else if (Array.isArray(chunk)) {
        this._chunks.push(Uint8Array.from(chunk));
      } else if (typeof chunk === 'string') {
        const bytes = new Uint8Array(chunk.length);
        for (let i = 0; i < chunk.length; i++) bytes[i] = chunk.charCodeAt(i) & 0xff;
        this._chunks.push(bytes);
      } else {
        try { this._chunks.push(new Uint8Array(chunk)); }
        catch (e) { console.warn('BlobStream.write: type inconnu', typeof chunk); }
      }
      return true;
    }

    end(chunk) {
      if (chunk) this.write(chunk);
      setTimeout(() => {
        this._blob = new Blob(this._chunks, { type: 'application/pdf' });
        this._chunks = [];
        this.emit('finish');
        this.emit('close');
      }, 0);
      return this;
    }

    destroy() {
      this._chunks = [];
      this.writable = false;
    }

    /* ── API blob-stream ── */

    toBlobURL(mimeType) {
      if (!this._blob) throw new Error('BlobStream: end() pas encore appelé');
      const blob = mimeType ? new Blob([this._blob], { type: mimeType }) : this._blob;
      return URL.createObjectURL(blob);
    }

    toBlob() {
      return this._blob;
    }
  }

  /* ── Export global ── */
  global.blobStream = () => new BlobStream();

}(typeof window !== 'undefined' ? window : this));
