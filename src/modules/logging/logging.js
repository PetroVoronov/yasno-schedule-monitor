const {Logger} = require('telegram/extensions/Logger');
class SecuredLogger extends Logger {
  constructor(...args) {
    super(...args);
    this.maskCharactersVisible = 3;
  }
  maskWords = [
    'token',
    'secret',
    'key',
    'pass',
    'pwd',
    'auth',
    'username',
    'user',
    'mail',
    'login',
    'credential',
    'session',
    'cookie',
    'bearer',
  ];

  _log(level, message, color) {
    if (this.canSend(level)) {
      if (typeof message === 'string') {
        super._log(level, message, color);
      } else if (Array.isArray(message)) {
        const messageText = message.map((item) => this.processMessageObject(item)).join('');
        super._log(level, messageText, color);
      }
    }
  }

  processMessageObject(message) {
    if (typeof message === 'object') {
      return Object.entries(message)
        .map(([key, value]) => this.processMessageItem(key, value))
        .join(', ');
    } else {
      return message;
    }
  }

  maskString(value) {
    if (typeof value !== 'string') {
      return value;
    } else {
      let visibleLength = this.maskCharactersVisible;
      if ((value.startsWith(`"`) && value.endsWith(`"`)) || (value.startsWith(`'`) && value.endsWith(`'`))) {
        visibleLength += 1;
      }
      if (value.length < visibleLength * 2) {
        return '*'.repeat(value.length);
      } else if (value.length < visibleLength * 3) {
        return value.substring(0, visibleLength) + '*'.repeat(value.length - visibleLength);
      } else {
        return (
          value.substring(0, visibleLength) + '*'.repeat(value.length - visibleLength * 2) + value.substring(value.length - visibleLength)
        );
      }
    }
  }

  setMaskCharactersVisible(value) {
    this.maskCharactersVisible = value;
  }

  setMaskWords(value) {
    if (Array.isArray(value)) {
      this.maskWords = value;
    }
  }

  appendMaskWord(...value) {
    this.maskWords.push(...value.map((item) => item.toLowerCase()));
  }

  removeMaskWord(...value) {
    this.maskWords = this.maskWords.filter((word) => !value.map((item) => item.toLowerCase()).includes(word));
  }

  maskMessageItem(key, value) {
    if (typeof key === 'string' && typeof value === 'string') {
      const keyLower = key.toLowerCase();
      return this.maskWords.some((word) => keyLower.includes(word)) ? this.maskString(value) : value;
    }
    return value;
  }

  processMessageItem(key, value) {
    let maskedValue = this.maskMessageItem(key, value);
    if (key.startsWith('-')) {
      return maskedValue;
    } else {
      if (typeof maskedValue === 'string') {
        maskedValue = `"${maskedValue}"`;
      }
      return `${key}: ${maskedValue}`;
    }
  }

  error(...message) {
    super.error(message);
  }

  warn(...message) {
    super.warn(message);
  }

  info(...message) {
    super.info(message);
  }

  debug(...message) {
    super.debug(message);
  }
}

const securedLogger = new SecuredLogger('info');

exports.securedLogger = securedLogger;
