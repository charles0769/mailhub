// MailHub — 多厂商邮件聚合客户端（IMAP 收 / SMTP 发）
require('dns').setDefaultResultOrder('ipv4first');
// 强制所有 DNS 解析只返回 IPv4
var _dns = require('dns');
var _origLookup = _dns.lookup;
_dns.lookup = function (hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  if (typeof options === 'number') { options = { family: options }; }
  options = options || {};
  options.family = 4;
  return _origLookup.call(this, hostname, options, callback);
};

const express = require('express');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const db = require('./store.js');

const app = express();
app.use(express.json());
app.use(express.static('public', { etag: false, lastModified: false, setHeaders: function(res) { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); } }));

// 厂商预设
var PROVIDERS = {
  qq: { name: 'QQ 邮箱', imap: 'imap.qq.com', imap_port: 993, smtp: 'smtp.qq.com', smtp_port: 465, note: '需开启 IMAP 并生成授权码' },
  '163': { name: '网易 163', imap: 'imap.163.com', imap_port: 993, smtp: 'smtp.163.com', smtp_port: 465, note: '需开启 IMAP 并使用授权密码' },
  '126': { name: '网易 126', imap: 'imap.126.com', imap_port: 993, smtp: 'smtp.126.com', smtp_port: 465, note: '同 163' },
  gmail: { name: 'Gmail', imap: 'imap.gmail.com', imap_port: 993, smtp: 'smtp.gmail.com', smtp_port: 465, note: '需应用专用密码' },
  outlook: { name: 'Outlook', imap: 'outlook.office365.com', imap_port: 993, smtp: 'smtp.office365.com', smtp_port: 587, note: '可能需应用密码' },
  yahoo: { name: 'Yahoo', imap: 'imap.mail.yahoo.com', imap_port: 993, smtp: 'smtp.mail.yahoo.com', smtp_port: 465, note: '需应用密码' },
  icloud: { name: 'iCloud', imap: 'imap.mail.me.com', imap_port: 993, smtp: 'smtp.mail.me.com', smtp_port: 587, note: '需应用专用密码' },
  sina: { name: '新浪邮箱', imap: 'imap.sina.com', imap_port: 993, smtp: 'smtp.sina.com', smtp_port: 465, note: '' },
  aliyun: { name: '阿里企业邮', imap: 'imap.qiye.aliyun.com', imap_port: 993, smtp: 'smtp.qiye.aliyun.com', smtp_port: 465, note: '' },
  tencent_ex: { name: '腾讯企业邮', imap: 'imap.exmail.qq.com', imap_port: 993, smtp: 'smtp.exmail.qq.com', smtp_port: 465, note: '' },
  custom: { name: '自定义', imap: '', imap_port: 993, smtp: '', smtp_port: 587, note: '手动填写' },
};
app.get('/api/providers', function(req, res) { res.json(PROVIDERS); });

// 帐号
app.get('/api/accounts', function(req, res) {
  res.json(db.accounts.all().map(function(a) { return { id: a.id, email: a.email, provider: a.provider, imap_host: a.imap_host, smtp_host: a.smtp_host, created_at: a.created_at }; }));
});
app.post('/api/accounts', function(req, res) {
  var b = req.body;
  var p = PROVIDERS[b.provider] || PROVIDERS.custom;
  var ih = b.imap_host || p.imap, ip = b.imap_port || p.imap_port;
  var sh = b.smtp_host || p.smtp, sp = b.smtp_port || p.smtp_port;
  if (!b.email || !b.password) return res.status(400).json({ error: 'email/password 必填' });
  if (db.accounts.getByEmail(b.email)) return res.status(400).json({ error: '该邮箱已添加' });
  var nid = db.accounts.insert({ email: b.email, provider: b.provider, imap_host: ih, imap_port: ip, imap_tls: 1, smtp_host: sh, smtp_port: sp, smtp_tls: sp === 587 ? 0 : 1, user: b.email, pass: b.password, created_at: Math.floor(Date.now() / 1000) });
  res.json({ id: nid });
});
app.delete('/api/accounts/:id', function(req, res) {
  db.accounts.del(req.params.id);
  res.json({ ok: true });
});

// IMAP 客户端（强制 IPv4）
function getClient(acc) {
  return new ImapFlow({
    host: acc.imap_host, port: acc.imap_port,
    secure: !!acc.imap_tls,
    auth: { user: acc.user, pass: acc.pass },
    logger: false,
    tls: { rejectUnauthorized: false },
    socketTimeout: 120000,
    greetingTimeout: 30000,
    family: 4,
  });
}

// 连接测试
app.post('/api/accounts/:id/test', async function(req, res) {
  var acc = db.accounts.get(req.params.id);
  if (!acc) return res.status(404).json({ error: '帐号不存在' });
  var client = getClient(acc);
  try {
    await client.connect();
    var mb = await client.status('INBOX', { messages: true, unseen: true });
    await client.logout();
    res.json({ ok: true, messages: mb.messages, unseen: mb.unseen });
  } catch (e) {
    try { await client.logout(); } catch(_) {}
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 拉取邮件
app.post('/api/accounts/:id/fetch', async function(req, res) {
  var acc = db.accounts.get(req.params.id);
  if (!acc) return res.status(404).json({ error: '帐号不存在' });
  try {
    var addrs = await new Promise(function(resolve, reject) {
      require('dns').resolve4(acc.imap_host, function(err, a) { if (err) reject(err); else resolve(a); });
    });
    if (addrs && addrs.length) acc.imap_host = addrs[0];
  } catch(e) {}
  var client = getClient(acc);
  var inserted = { added: 0, updated: 0 };
  var fetched = 0;
  try {
    await client.connect();
    var lock = await client.getMailboxLock('INBOX');
    var seenSync = [];
    try {
      var status = await client.status('INBOX', { messages: true });
      var total = status.messages || 0;
      var start = Math.max(1, total - 99);
      var range = start + ':*';
      for await (var msg of client.fetch(range, { uid: true, envelope: true, source: true, flags: true })) {
        fetched++;
        if (fetched > 100) continue;
        var parsed = await simpleParser(msg.source);
        var subject = parsed.subject || '(无主题)';
        var fromAddr = parsed.from ? parsed.from.text : '';
        var toAddr = parsed.to ? parsed.to.text : '';
        var date = parsed.date ? Math.floor(parsed.date.getTime() / 1000) : Math.floor(Date.now() / 1000);
        var bodyHtml = parsed.html || '';
        var bodyText = parsed.text || '';
        if (bodyHtml) bodyHtml = bodyHtml.replace(/<img[^>]*src=["']https?:\/\/[^"']*["'][^>]*>/gi, function(match) {
          var altM = match.match(/alt=["']([^"']*)["']/i);
          return '<span style="display:inline-block;background:#eee;color:#999;padding:2px 8px;border-radius:3px;font-size:11px;margin:2px 0">[图片' + (altM ? ': ' + altM[1] : '') + ']</span>';
        });
        var styled;
        if (bodyHtml) {
          styled = bodyHtml.replace(/<head([^>]*)>/i, '<head$1><style>body{font:15px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:720px;margin:0 auto;padding:20px;color:#222}img{max-width:100%;height:auto}table{max-width:100%!important}</style>');
        } else {
          styled = '<div style="font:15px/1.7 sans-serif;white-space:pre-wrap;max-width:720px;margin:0 auto;padding:20px;color:#222">' + bodyText + '</div>';
        }
        var body = styled;
        var snippet = bodyText.slice(0, 150) || '';
        var serverSeen = msg.flags.has('\\Seen');
        var exist = db.mails.exist(acc.id, 'INBOX', String(msg.uid));
        if (exist) {
          if (exist.seen && !serverSeen) seenSync.push(String(msg.uid));
          if (!exist.seen && serverSeen) db.mails.markSeen(exist.id);
          inserted.updated++;
        } else {
          db.mails.insert({ account_id: acc.id, uid: String(msg.uid), folder: 'INBOX', subject: subject, from_addr: fromAddr, to_addr: toAddr, date: date, body: body, snippet: snippet, seen: serverSeen ? 1 : 0 });
          inserted.added++;
        }
      }
      if (seenSync.length) {
        await client.messageFlagsAdd(seenSync, ['\\Seen'], { uid: true });
        console.log('[' + acc.email + '] 已读同步: ' + seenSync.length + ' 封');
      }
    } finally {
      lock.release();
    }
    await client.logout();
    console.log('[' + acc.email + '] fetched=' + fetched + ' added=' + inserted.added + ' updated=' + inserted.updated);
    res.json({ ok: true, fetched: fetched, added: inserted.added, updated: inserted.updated });
  } catch (e) {
    try { await client.logout(); } catch(_) {}
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 邮件列表
app.get('/api/accounts/:id/mails', function(req, res) {
  var q = req.query.q || '';
  var size = 30, off = 0;
  var result = db.mails.list(req.params.id, 'INBOX', q, size, off);
  res.json(result);
});

// 单封
app.get('/api/mails/:id', function(req, res) {
  var row = db.mails.find(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  var wasSeen = row.seen; // 快照标记前状态（find 返回引用，markSeen 会原地改 seen）
  db.mails.markSeen(row.id);
  res.json(Object.assign({}, row, { seen: wasSeen }));
});
app.post('/api/mails/:id/star', function(req, res) {
  db.mails.toggleStar(req.params.id);
  res.json({ ok: true });
});
app.post('/api/mails/:id/unread', function(req, res) {
  db.mails.markUnread(req.params.id);
  res.json({ ok: true });
});
app.delete('/api/mails/:id', function(req, res) {
  db.mails.del(req.params.id);
  res.json({ ok: true });
});

// 同步 IMAP 已读
app.post('/api/accounts/:id/markSeen', async function(req, res) {
  var acc = db.accounts.get(req.params.id);
  if (!acc) return res.status(404).json({ error: '帐号不存在' });
  var uid = req.body && req.body.uid;
  if (!uid) return res.status(400).json({ error: 'uid 必填' });
  var client = getClient(acc);
  client.connect().then(function() {
    return client.mailboxOpen('INBOX');
  }).then(function() {
    return client.messageFlagsAdd([String(uid)], ['\\Seen'], { uid: true });
  }).then(function() {
    return client.logout();
  }).then(function() {
    res.json({ ok: true });
  }).catch(function(e) {
    try { client.logout(); } catch(_) {}
    res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  });
});

// 发送
app.post('/api/accounts/:id/send', async function(req, res) {
  var acc = db.accounts.get(req.params.id);
  if (!acc) return res.status(404).json({ error: '帐号不存在' });
  var to = req.body.to, subject = req.body.subject, body = req.body.body;
  if (!to || !subject) return res.status(400).json({ error: 'to/subject 必填' });
  var smtpIP = acc.smtp_host;
  try {
    var results = await new Promise(function(resolve, reject) {
      require('dns').resolve4(acc.smtp_host, function(err, a) { if (err) reject(err); else resolve(a); });
    });
    if (results && results.length) smtpIP = results[0];
  } catch(e) {}
  var transporter = nodemailer.createTransport({
    host: smtpIP, port: acc.smtp_port || 465,
    secure: true,
    auth: { user: acc.user, pass: acc.pass },
    tls: { rejectUnauthorized: false, servername: acc.smtp_host },
  });
  try {
    var info = await transporter.sendMail({ from: acc.email, to: to, subject: subject, html: body });
    db.outbox.insert({ account_id: acc.id, to_addr: to, subject: subject, body: body });
    res.json({ ok: true, messageId: info.messageId });
  } catch (e) {
    db.outbox.insert({ account_id: acc.id, to_addr: to, subject: subject, body: body, status: 'failed: ' + String(e.message || e).slice(0, 200) });
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 已发送
app.get('/api/accounts/:id/outbox', function(req, res) {
  res.json(db.outbox.list(req.params.id));
});

// 定时自动拉取（3 分钟）
setInterval(function() {
  db.accounts.all().forEach(function(acc) {
    var client = getClient(acc);
    client.connect().then(function() {
      return client.mailboxOpen('INBOX');
    }).then(function() {
      return client.search({ seen: false }, { uid: true });
    }).then(function(uids) {
      if (!uids.length) { client.logout(); return; }
      var inserted = 0;
      var uids2 = uids.slice(-30);
      var done = Promise.resolve();
      uids2.forEach(function(uid) {
        done = done.then(function() {
          return client.fetchOne(String(uid), { envelope: true, source: true, flags: true, uid: true }).then(function(msg) {
            if (!msg) return;
            return simpleParser(msg.source).then(function(parsed) {
              var subject = parsed.subject || '(无主题)';
              var fromAddr = parsed.from ? parsed.from.text : '';
              var date = parsed.date ? Math.floor(parsed.date.getTime() / 1000) : Math.floor(Date.now() / 1000);
              var bodyHtml = (parsed.html || '').replace(/<img[^>]*src=["']https?:\/\/[^"']*["'][^>]*>/gi, function(match) {
                var altM = match.match(/alt=["']([^"']*)["']/i);
                return '<span style="display:inline-block;background:#eee;color:#999;padding:2px 8px;border-radius:3px;font-size:11px">[图片' + (altM ? ': ' + altM[1] : '') + ']</span>';
              });
              var styled;
              if (bodyHtml) {
                styled = bodyHtml.replace(/<head([^>]*)>/i, '<head$1><style>body{font:15px/1.7 sans-serif;max-width:720px;margin:0 auto;padding:20px;color:#222}img{max-width:100%}</style>' + bodyHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ''));
              } else {
                styled = '<div style="font:15px/1.7 sans-serif;white-space:pre-wrap;max-width:720px;margin:0 auto;padding:20px">' + (parsed.text || '') + '</div>';
              }
              if (!db.mails.exist(acc.id, 'INBOX', String(msg.uid))) {
                db.mails.insert({ account_id: acc.id, uid: String(msg.uid), folder: 'INBOX', subject: subject, from_addr: fromAddr, to_addr: toAddr, date: date, body: styled, snippet: (parsed.text || '').slice(0, 150), seen: 0 });
                inserted++;
                console.log('[' + acc.email + '] 新邮件: ' + subject.slice(0, 40));
              }
            });
          });
        });
      });
      return done.then(function() { return client.logout(); });
    }).catch(function(e) {
      try { client.logout(); } catch(_) {}
      console.log('[' + acc.email + '] 自动拉取: ' + String(e.message || e).slice(0, 80));
    });
  });
}, 180000);

var PORT = process.env.PORT || 18090;
app.listen(PORT, function() { console.log('MailHub :' + PORT); });
