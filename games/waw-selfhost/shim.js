/* ตัวแทนระบบห้องออนไลน์: ทำให้เกมคุยกับเซิร์ฟเวอร์ของเราผ่าน WebSocket แทนระบบของ Claude */
(function () {
  window.__STANDALONE = true;
  function wsUrl() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + location.pathname.replace(/[^/]*$/, '') + 'ws'; }

  function join(name) {
    return new Promise(function (resolve, reject) {
      var st = { me: '', peers: {}, pres: {}, hp: [], hm: {}, closed: false, tries: 0, ws: null, ready: false };

      function snap() {
        return Object.keys(st.peers).map(function (id) {
          return { peer: id, by: null, isMe: id === st.me, sameTab: id === st.me, kind: 'viewer', guest: false,
                   presence: st.peers[id], updatedAt: Date.now() };
        });
      }
      function notify(ch) {
        var s = snap();
        st.hp.slice().forEach(function (f) {
          try { f({ peers: s, joined: (ch && ch.joined) || [], left: (ch && ch.left) || [], updated: (ch && ch.updated) || [] }); } catch (e) {}
        });
      }
      function only(id) { return snap().filter(function (p) { return p.peer === id; }); }

      function connect() {
        var ws = new WebSocket(wsUrl());
        st.ws = ws;
        ws.onopen = function () { ws.send(JSON.stringify({ t: 'join', room: name, presence: st.pres })); };
        ws.onmessage = function (ev) {
          var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (m.t === 'joined') {
            st.me = m.peer; st.peers = {};
            m.peers.forEach(function (p) { st.peers[p.peer] = p.presence || {}; });
            st.peers[st.me] = Object.assign({}, st.pres);
            st.tries = 0;
            if (!st.ready) { st.ready = true; resolve(api); } else { notify({}); }
          } else if (m.t === 'peer') {
            var isNew = !(m.peer in st.peers);
            st.peers[m.peer] = m.presence || {};
            notify(isNew ? { joined: only(m.peer) } : { updated: only(m.peer) });
          } else if (m.t === 'left') {
            var gone = only(m.peer); delete st.peers[m.peer]; notify({ left: gone });
          } else if (m.t === 'msg') {
            (st.hm[m.topic] || []).slice().forEach(function (h) {
              try { h({ topic: m.topic, data: m.data, peer: m.peer, by: null, isMe: m.peer === st.me, sameTab: m.peer === st.me, kind: 'viewer', guest: false }); } catch (e) {}
            });
          } else if (m.t === 'error' && !st.ready) {
            reject({ code: m.code || 'not_permitted' });
          }
        };
        ws.onclose = function () {
          if (st.closed) return;
          if (!st.ready) { reject({ code: 'upstream_error' }); return; }
          if (st.tries < 6) { st.tries++; setTimeout(connect, Math.min(5000, 500 * st.tries)); }
        };
        ws.onerror = function () {};
      }

      var api = {
        name: name,
        emit: function (topic, data) {
          if (st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify({ t: 'emit', topic: topic, data: data }));
          return Promise.resolve();
        },
        on: function (topic, h) {
          (st.hm[topic] = st.hm[topic] || []).push(h);
          return function () { st.hm[topic] = (st.hm[topic] || []).filter(function (x) { return x !== h; }); };
        },
        presence: function (patch) {
          Object.keys(patch).forEach(function (k) { if (patch[k] === null) delete st.pres[k]; else st.pres[k] = patch[k]; });
          if (st.me) st.peers[st.me] = Object.assign({}, st.pres);
          if (st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify({ t: 'presence', patch: patch }));
          if (st.me) notify({ updated: only(st.me) });
          return Promise.resolve();
        },
        peers: function () { return snap(); },
        onPeers: function (h) {
          st.hp.push(h);
          return function () { st.hp = st.hp.filter(function (x) { return x !== h; }); };
        },
        connected: function () { return !!(st.ws && st.ws.readyState === 1); },
        leave: function () {
          st.closed = true;
          try { if (st.ws) { st.ws.send(JSON.stringify({ t: 'leave' })); st.ws.close(); } } catch (e) {}
          return Promise.resolve();
        },
        _drop: function () { try { st.ws.close(); } catch (e) {} } /* ใช้ทดสอบการต่อใหม่ */
      };
      connect();
    });
  }

  window.claude = {
    use: function (name) { return Promise.resolve(name === 'room' ? { join: join } : null); }
  };
})();
