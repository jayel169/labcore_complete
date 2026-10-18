function postgresSsl() {
  if (process.env.PGSSL === 'disable') return false;
  if (process.env.PGSSL === 'require') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

module.exports = { postgresSsl };
