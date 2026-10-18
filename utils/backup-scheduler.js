const path = require('path');
const { spawn } = require('child_process');

function delayUntilNextBackup(now) {
  const next = new Date(now);
  next.setUTCHours(2, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

function startBackupScheduler() {
  const bucket = process.env.BACKUP_S3_BUCKET;
  const region = process.env.AWS_REGION;
  if (!bucket && !region) {
    console.warn('[backup] remote backup is not configured; automatic backups are disabled.');
    return;
  }
  if (!bucket || !region) {
    throw new Error('Configure both BACKUP_S3_BUCKET and AWS_REGION to enable remote backups.');
  }

  const backupScript = path.join(__dirname, '..', 'backup.js');
  let retryCount = 0;
  let running = false;

  function runBackup() {
    if (running) return;
    running = true;
    const child = spawn(process.execPath, [backupScript], {
      env: process.env,
      stdio: 'inherit'
    });
    let failedToStart = false;
    child.once('error', error => {
      failedToStart = true;
      running = false;
      console.error('[backup] could not start backup process:', error);
      scheduleRetry();
    });
    child.once('close', code => {
      if (failedToStart) return;
      running = false;
      if (code === 0) {
        retryCount = 0;
        console.log('[backup] run completed successfully.');
      } else {
        console.error('[backup] process exited with code', code);
        scheduleRetry();
      }
    });
  }

  function scheduleRetry() {
    if (retryCount >= 3) {
      console.error('[backup] automatic retries exhausted; investigate before the next scheduled run.');
      return;
    }
    retryCount++;
    const delay = retryCount * 5 * 60 * 1000;
    console.error('[backup] retry', retryCount, 'scheduled in', delay / 60000, 'minutes.');
    setTimeout(runBackup, delay);
  }

  setTimeout(runBackup, 15000);
  function scheduleDaily() {
    setTimeout(() => {
      runBackup();
      scheduleDaily();
    }, delayUntilNextBackup(new Date()));
  }
  scheduleDaily();
  console.log('[backup] remote daily backups enabled; initial snapshot in 15 seconds, then 02:00 UTC.');
}

module.exports = { startBackupScheduler, delayUntilNextBackup };
