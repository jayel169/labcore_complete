function convertPlaceholders(sql) {
  let index = 0;
  let quote = null;
  let output = '';
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (quote) {
      output += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) output += sql[++i];
        else quote = null;
      } else if (ch === '\\' && quote === "'") {
        output += sql[++i] || '';
      }
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      if (end < 0) {
        output += sql.slice(i);
        break;
      }
      output += sql.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) {
        output += sql.slice(i);
        break;
      }
      output += sql.slice(i, end + 2);
      i = end + 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      output += ch;
    } else if (ch === '?') {
      output += '$' + (++index);
    } else {
      output += ch;
    }
  }
  return output;
}

function convertNamedPlaceholders(sql, values) {
  let quote = null;
  let output = '';
  const params = [];
  const indices = new Map();
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (quote) {
      output += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) output += sql[++i];
        else quote = null;
      } else if (ch === '\\' && quote === "'") {
        output += sql[++i] || '';
      }
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      if (end < 0) {
        output += sql.slice(i);
        break;
      }
      output += sql.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) {
        output += sql.slice(i);
        break;
      }
      output += sql.slice(i, end + 2);
      i = end + 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      output += ch;
      continue;
    }
    if (ch === '@' && /[A-Za-z_]/.test(sql[i + 1] || '')) {
      let end = i + 2;
      while (/[A-Za-z0-9_]/.test(sql[end] || '')) end += 1;
      const name = sql.slice(i + 1, end);
      if (!Object.prototype.hasOwnProperty.call(values, name)) {
        throw new Error(`Missing value for named SQL parameter: ${name}`);
      }
      if (!indices.has(name)) {
        indices.set(name, params.push(values[name]));
      }
      output += '$' + indices.get(name);
      i = end - 1;
      continue;
    }
    output += ch;
  }
  return { sql: convertPlaceholders(output), params };
}

function postgresSchema(source) {
  return source
    .replace(/^\s*PRAGMA[^;]*;\s*$/gmi, '')
    .replace(/INSERT INTO specimen_events[\s\S]*?;\s*(?=-- QC limits)/, '')
    .replace(/INTEGER\s+PRIMARY KEY\s+AUTOINCREMENT/gi, 'BIGSERIAL PRIMARY KEY')
    .replace(/\bREAL\b/gi, 'DOUBLE PRECISION')
    .replace(/\s+COLLATE\s+NOCASE/gi, '');
}

module.exports = { convertPlaceholders, convertNamedPlaceholders, postgresSchema };
