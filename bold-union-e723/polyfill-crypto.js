const crypto = require('node:crypto');

if (typeof crypto.hash !== 'function') {
  crypto.hash = function(algorithm, data, outputEncoding) {
    const hash = crypto.createHash(algorithm).update(data);
    return outputEncoding ? hash.digest(outputEncoding) : hash.digest();
  };
}

if (typeof globalThis.File === 'undefined') {
  globalThis.File = require('node:buffer').File;
}

if (typeof String.prototype.toWellFormed !== 'function') {
  String.prototype.toWellFormed = function() {
    return this.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
  };
}


