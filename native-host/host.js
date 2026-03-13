#!/usr/bin/env node

/**
 * Doubao Collector - Native Messaging Host
 * Enables saving Markdown files to any user-chosen directory.
 *
 * Protocol: Chrome Native Messaging
 * - Input: 4-byte length (LE uint32) + JSON message
 * - Output: 4-byte length (LE uint32) + JSON response
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

process.stdin.resume();
process.stdin.on('readable', () => {
  readMessage();
});

let inputBuffer = Buffer.alloc(0);

function readMessage() {
  let chunk;
  while ((chunk = process.stdin.read()) !== null) {
    inputBuffer = Buffer.concat([inputBuffer, chunk]);
  }

  // Need at least 4 bytes for the length prefix
  while (inputBuffer.length >= 4) {
    const messageLength = inputBuffer.readUInt32LE(0);

    if (inputBuffer.length < 4 + messageLength) {
      // Wait for more data
      return;
    }

    const messageJson = inputBuffer.slice(4, 4 + messageLength).toString('utf-8');
    inputBuffer = inputBuffer.slice(4 + messageLength);

    try {
      const message = JSON.parse(messageJson);
      handleMessage(message);
    } catch (err) {
      sendResponse({ success: false, error: `JSON parse error: ${err.message}` });
    }
  }
}

function sendResponse(response) {
  const json = JSON.stringify(response);
  const buffer = Buffer.from(json, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buffer.length, 0);
  process.stdout.write(header);
  process.stdout.write(buffer);
}

async function handleMessage(message) {
  const { action } = message;

  switch (action) {
    case 'ping':
      sendResponse({ success: true, version: '1.0.0' });
      break;

    case 'save':
      await handleSave(message);
      break;

    case 'list':
      await handleList(message);
      break;

    case 'openDir':
      handleOpenDir(message);
      break;

    default:
      sendResponse({ success: false, error: `Unknown action: ${action}` });
  }
}

async function handleSave({ path: filePath, content }) {
  try {
    if (!filePath || !content) {
      sendResponse({ success: false, error: 'Missing path or content' });
      return;
    }

    // Ensure directory exists
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    // Write file
    fs.writeFileSync(filePath, content, 'utf-8');
    sendResponse({ success: true, path: filePath });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleList({ dir }) {
  try {
    if (!dir || !fs.existsSync(dir)) {
      sendResponse({ success: false, error: 'Directory not found' });
      return;
    }

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const fullPath = path.join(dir, f);
        const stat = fs.statSync(fullPath);
        return { name: f, path: fullPath, size: stat.size, modified: stat.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));

    sendResponse({ success: true, files });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

function handleOpenDir({ dir }) {
  if (!dir) {
    sendResponse({ success: false, error: 'No directory specified' });
    return;
  }

  // Open in system file explorer (cross-platform)
  const platform = process.platform;
  let cmd;
  if (platform === 'win32') {
    cmd = `explorer "${dir.replace(/\//g, '\\')}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${dir}"`;
  } else {
    cmd = `xdg-open "${dir}"`;
  }
  exec(cmd, (err) => {
    // explorer on Windows returns exit code 1 even on success, ignore
    sendResponse({ success: true });
  });
}
