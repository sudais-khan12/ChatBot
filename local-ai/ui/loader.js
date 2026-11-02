/*
 * Local AI assistant - status panel.
 *
 * Loaded through Open WebUI's official /static/loader.js hook. It only ADDS a
 * floating panel and never modifies Open WebUI's own DOM, so Svelte re-renders
 * cannot fight it and no branding is altered or obscured.
 *
 * All live data comes from Open WebUI's own authenticated proxy, so the panel
 * reports exactly what the chat sees.
 */
(function () {
	'use strict';

	var REFRESH_MS = 10000;
	var STORE_KEY = 'lap-panel-open';

	// Total VRAM on this machine (Quadro T2000 = 4096 MiB). Used for the
	// GPU memory card; change it if the hardware ever changes.
	var GPU_TOTAL_BYTES = 4096 * 1024 * 1024;

	// Rough but stable: English averages ~4 characters per token. The context
	// card labels its numbers as estimated because of this.
	var CHARS_PER_TOKEN = 4;

	var PATHS = {
		chats: 'D:\\olama\\open-webui',
		models: 'D:\\olama\\models'
	};

	var ICONS = {
		computer: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
		folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
		chip: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1"/><path d="M9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>',
		bolt: '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
		eye: '<svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>',
		db: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
		plug: '<svg viewBox="0 0 24 24"><path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5"/></svg>',
		clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
		gauge: '<svg viewBox="0 0 24 24"><path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM13.4 10.6 19 5M4 20a9 9 0 1 1 16 0"/></svg>'
	};

	var ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

	function esc(value) {
		if (value === undefined || value === null) return '';
		return String(value).replace(/[&<>"']/g, function (ch) {
			return ENTITIES[ch];
		});
	}

	function gb(bytes) {
		if (!bytes) return '';
		return (bytes / 1073741824).toFixed(1) + ' GB';
	}

	function kilo(n) {
		if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
		return String(n);
	}

	function pct(part, whole) {
		if (!whole) return 0;
		return (part / whole) * 100;
	}

	function pctLabel(value) {
		if (value <= 0) return '0%';
		if (value < 10) return value.toFixed(1) + '%';
		return Math.round(value) + '%';
	}

	// Cookie auth covers this; the bearer token is a fallback for odd setups.
	function api(path, options) {
		var opts = options || {};
		var headers = { 'Content-Type': 'application/json' };
		try {
			if (localStorage.token) headers.Authorization = 'Bearer ' + localStorage.token;
		} catch (e) {
			/* storage blocked */
		}

		return fetch(path, {
			method: opts.method || 'GET',
			credentials: 'same-origin',
			headers: headers,
			body: opts.body ? JSON.stringify(opts.body) : undefined
		}).then(function (r) {
			if (!r.ok) throw new Error(path + ' -> ' + r.status);
			return r.status === 204 ? null : r.json();
		});
	}

	function quiet(path, options) {
		return api(path, options).catch(function () {
			return null;
		});
	}

	/* ---------------------------------------------------------------- views */

	function row(icon, label, value, opts) {
		opts = opts || {};
		var sub = opts.sub ? ' <span class="lap-sub">- ' + esc(opts.sub) + '</span>' : '';
		var badge = opts.badge
			? '<span class="lap-badge lap-badge-' + opts.badgeKind + '">' + esc(opts.badge) + '</span>'
			: '';
		var cls = opts.valueClass ? ' ' + opts.valueClass : '';
		var attrs = opts.attrs || '';
		var rowCls = 'lap-row' + (opts.click ? ' lap-click' : '');

		return (
			'<div class="' + rowCls + '"' + attrs + '>' +
			(ICONS[icon] || '') +
			'<span class="lap-label">' + esc(label) + sub + '</span>' +
			badge +
			(value ? '<span class="lap-value' + cls + '"' + (opts.valueId ? ' id="' + opts.valueId + '"' : '') + '>' + esc(value) + '</span>' : '') +
			(opts.button ? '<button class="lap-btn" ' + opts.button.attrs + '>' + esc(opts.button.label) + '</button>' : '') +
			'</div>'
		);
	}

	// Header number + segmented bar + legend, as used by Context and GPU cards.
	function usage(big, sub, segments) {
		var bar = segments
			.filter(function (s) {
				return s.value > 0;
			})
			.map(function (s) {
				return '<i style="width:' + s.percent.toFixed(2) + '%;background:' + s.colour + '"></i>';
			})
			.join('');

		var legend = segments
			.map(function (s) {
				return (
					'<div class="lap-leg">' +
					'<span class="lap-swatch" style="background:' + s.colour + '"></span>' +
					'<span class="lap-leg-label">' + esc(s.label) + '</span>' +
					'<span class="lap-leg-val">' + esc(s.display) + '</span>' +
					'<span class="lap-leg-pct">' + pctLabel(s.percent) + '</span>' +
					'</div>'
				);
			})
			.join('');

		return (
			'<div class="lap-usage"><span class="lap-usage-big">' + esc(big) + '</span>' +
			'<span class="lap-usage-sub">' + esc(sub) + '</span></div>' +
			'<div class="lap-bar">' + bar + '</div>' +
			legend
		);
	}

	var firstPaint = true;

	function card(id, title, bodyHtml, note) {
		var collapsed = false;
		try {
			collapsed = localStorage.getItem('lap-c-' + id) === '1';
		} catch (e) {
			/* storage blocked */
		}

		return (
			'<div class="lap-card' + (collapsed ? ' lap-collapsed' : '') +
			(firstPaint ? ' lap-in' : '') + '" data-card="' + id + '">' +
			'<div class="lap-card-head">' + esc(title) +
			' <span class="lap-caret">&#9660;</span>' +
			(note ? '<span class="lap-head-note">' + esc(note) + '</span>' : '') +
			'</div><div class="lap-card-body">' + bodyHtml + '</div></div>'
		);
	}

	/* ---------------------------------------------------------------- cards */

	var COLOURS = {};

	function readColours() {
		var cs = getComputedStyle(document.documentElement);
		['blue', 'green', 'amber', 'red', 'purple', 'cyan', 'pink', 'track'].forEach(function (k) {
			COLOURS[k] = cs.getPropertyValue('--lap-' + k).trim() || '#888';
		});
	}

	function environmentCard(tags, ollamaOk) {
		return (
			row('computer', 'This computer', 'local') +
			row('plug', 'Ollama', ollamaOk ? 'connected' : 'offline', {
				sub: 'localhost:11434',
				valueClass: ollamaOk ? 'lap-good' : 'lap-bad'
			}) +
			row('chip', 'Models installed', String(tags.length))
		);
	}

	function contextCard(active, chat) {
		if (!active) {
			return '<div class="lap-empty">No model loaded</div>';
		}

		var window_ = active.context_length || 0;
		if (!window_) return '<div class="lap-empty">Context size unknown</div>';

		var systemChars = (chat && chat.system) || 0;
		var messageChars = (chat && chat.messages) || 0;

		var systemTokens = Math.ceil(systemChars / CHARS_PER_TOKEN);
		var messageTokens = Math.ceil(messageChars / CHARS_PER_TOKEN);
		var used = Math.min(systemTokens + messageTokens, window_);
		var free = Math.max(window_ - used, 0);

		var segments = [
			{
				label: 'Messages',
				value: messageTokens,
				percent: pct(messageTokens, window_),
				display: kilo(messageTokens),
				colour: COLOURS.blue
			},
			{
				label: 'System prompt',
				value: systemTokens,
				percent: pct(systemTokens, window_),
				display: kilo(systemTokens),
				colour: COLOURS.amber
			},
			{
				label: 'Free space',
				value: free,
				percent: pct(free, window_),
				display: kilo(free),
				colour: COLOURS.track
			}
		];

		return (
			usage(pctLabel(pct(used, window_)) + ' used', kilo(used) + ' / ' + kilo(window_), segments) +
			'<div class="lap-foot">Estimated from this chat at ~' + CHARS_PER_TOKEN +
			' characters per token.</div>'
		);
	}

	function gpuCard(active) {
		var onGpu = active ? active.size_vram || 0 : 0;
		var total = active ? active.size || 0 : 0;
		var spilled = Math.max(total - onGpu, 0);
		var free = Math.max(GPU_TOTAL_BYTES - onGpu, 0);

		// The bar charts VRAM only, so its segments always total 100%. Weights
		// that did not fit are in system RAM, not VRAM, so they are reported
		// separately rather than as a slice of the card.
		var segments = [
			{
				label: 'Model on GPU',
				value: onGpu,
				percent: pct(onGpu, GPU_TOTAL_BYTES),
				display: gb(onGpu) || '0 GB',
				colour: COLOURS.green
			},
			{
				label: 'Free VRAM',
				value: free,
				percent: pct(free, GPU_TOTAL_BYTES),
				display: gb(free) || '0 GB',
				colour: COLOURS.track
			}
		];

		var body = usage(
			pctLabel(pct(onGpu, GPU_TOTAL_BYTES)) + ' used',
			gb(onGpu) + ' / ' + gb(GPU_TOTAL_BYTES),
			segments
		);

		if (spilled > 0) {
			body += row('chip', 'Spilled to RAM', gb(spilled), { valueClass: 'lap-warn' });
			body += '<div class="lap-foot">Part of this model runs on the CPU, which is why it is slower.</div>';
		}

		return body;
	}

	function activeModelCard(active) {
		if (!active) {
			return (
				'<div class="lap-empty">No model loaded</div>' +
				'<div class="lap-foot">The next message waits while it loads from disk.</div>'
			);
		}

		var onGpu = active.size && active.size_vram
			? Math.round((active.size_vram / active.size) * 100)
			: null;

		var detail = [
			active.details && active.details.parameter_size,
			active.details && active.details.quantization_level
		]
			.filter(Boolean)
			.join(' - ');

		var html = row('bolt', active.name, onGpu === null ? 'loaded' : onGpu + '% GPU', {
			sub: detail,
			valueClass: onGpu === 100 ? 'lap-good' : 'lap-warn'
		});

		html += row('clock', 'Unloads in', '-', { valueId: 'lap-countdown' });

		html += row('gauge', 'Free the GPU', '', {
			button: { label: 'Unload', attrs: 'data-unload="' + esc(active.name) + '"' }
		});

		return html;
	}

	function modelsCard(tags, activeName) {
		if (!tags.length) return '<div class="lap-empty">None found</div>';

		return tags
			.map(function (m) {
				var vision = !!(m.capabilities && m.capabilities.indexOf('vision') > -1);
				var hot = m.name === activeName;

				return row(vision ? 'eye' : 'chip', m.name, gb(m.size), {
					click: !hot,
					badge: hot ? 'loaded' : vision ? 'vision' : '',
					badgeKind: hot ? 'hot' : 'vision',
					attrs: hot ? '' : ' data-warm="' + esc(m.name) + '"'
				});
			})
			.join('') + '<div class="lap-foot">Click a model to load it before you need it.</div>';
	}

	/* ------------------------------------------------------------- lifecycle */

	var panel;
	var toggle;
	var timer;
	var ticker;
	var expiresAt = null;

	function tick() {
		var el = document.getElementById('lap-countdown');
		if (!el) return;

		if (!expiresAt) {
			el.textContent = '-';
			return;
		}

		var secs = Math.round((expiresAt - Date.now()) / 1000);
		if (secs <= 0) {
			el.textContent = 'any moment';
			return;
		}

		var mins = Math.floor(secs / 60);
		el.textContent = mins > 0 ? mins + 'm ' + (secs % 60) + 's' : secs + 's';
	}

	function toast(message) {
		var box = document.getElementById('lap-toast');
		if (box) box.textContent = message;
	}

	function wire() {
		Array.prototype.forEach.call(panel.querySelectorAll('.lap-card-head'), function (head) {
			head.addEventListener('click', function () {
				var box = head.parentNode;
				box.classList.toggle('lap-collapsed');
				try {
					localStorage.setItem(
						'lap-c-' + box.getAttribute('data-card'),
						box.classList.contains('lap-collapsed') ? '1' : '0'
					);
				} catch (e) {
					/* storage blocked */
				}
			});
		});

		Array.prototype.forEach.call(panel.querySelectorAll('[data-warm]'), function (el) {
			el.addEventListener('click', function () {
				var name = el.getAttribute('data-warm');
				el.classList.remove('lap-click');
				toast('Loading ' + name + '. This can take a minute or two.');
				quiet('/ollama/api/generate', {
					method: 'POST',
					body: { model: name, prompt: '', keep_alive: '30m' }
				}).then(function () {
					toast('');
					refresh(true);
				});
			});
		});

		var unloadBtn = panel.querySelector('[data-unload]');
		if (unloadBtn) {
			unloadBtn.addEventListener('click', function () {
				var name = unloadBtn.getAttribute('data-unload');
				unloadBtn.disabled = true;
				unloadBtn.textContent = 'Unloading';
				quiet('/ollama/api/unload', { method: 'POST', body: { model: name } }).then(function () {
					refresh(true);
				});
			});
		}
	}

	function render(data) {
		var ps = (data.ps && data.ps.models) || [];
		var tags = (data.tags && data.tags.models) || [];
		var active = ps[0];

		expiresAt = active && active.expires_at ? new Date(active.expires_at).getTime() : null;

		panel.innerHTML =
			card('env', 'Environment', environmentCard(tags, data.ollamaOk)) +
			card('context', 'Context', contextCard(active, data.chat), active ? 'this chat' : '') +
			card('gpu', 'GPU memory', gpuCard(active)) +
			card('model', 'Active model', activeModelCard(active)) +
			card('models', 'Installed models', modelsCard(tags, active && active.name)) +
			card(
				'storage',
				'Storage',
				row('db', 'Chats & settings', '', { sub: PATHS.chats }) +
					row('folder', 'Models', '', { sub: PATHS.models })
			) +
			'<div class="lap-toast" id="lap-toast"></div>';

		var dot = toggle.querySelector('.lap-dot');
		if (dot) dot.className = 'lap-dot' + (active ? '' : ' lap-idle');

		firstPaint = false;
		wire();
		tick();
	}

	// Rebuilding the DOM on every poll would drop hover states and restart
	// transitions, so a refresh that changes nothing is skipped entirely.
	function signature(data) {
		var ps = (data.ps && data.ps.models) || [];
		var tags = (data.tags && data.tags.models) || [];

		return JSON.stringify([
			ps.map(function (m) {
				return [m.name, m.size_vram, m.size, m.expires_at, m.context_length];
			}),
			tags.map(function (m) {
				return m.name;
			}),
			data.chat
		]);
	}

	// Characters currently in this chat, for the context estimate.
	function readChat() {
		var match = location.pathname.match(/\/c\/([0-9a-f-]+)/i);
		if (!match) return Promise.resolve(null);

		return quiet('/api/v1/chats/' + match[1]).then(function (res) {
			if (!res || !res.chat) return null;

			var messages = res.chat.messages || [];
			var chars = messages.reduce(function (sum, m) {
				return sum + ((m && m.content) || '').length;
			}, 0);

			var system = (res.chat.params && res.chat.params.system) || '';
			return { messages: chars, system: system.length };
		});
	}

	var lastSignature = null;

	function refresh(force) {
		return Promise.all([quiet('/ollama/api/ps'), quiet('/ollama/api/tags'), readChat()]).then(function (res) {
			var data = { ps: res[0], tags: res[1], chat: res[2], ollamaOk: !!res[1] };
			var sig = signature(data);

			if (!force && sig === lastSignature) {
				tick();
				return;
			}

			lastSignature = sig;
			render(data);
		});
	}

	function setOpen(open) {
		panel.classList.toggle('lap-open', open);
		toggle.classList.toggle('lap-shifted', open);
		try {
			localStorage.setItem(STORE_KEY, open ? '1' : '0');
		} catch (e) {
			/* storage blocked */
		}

		clearInterval(timer);
		if (open) {
			refresh();
			timer = setInterval(refresh, REFRESH_MS);
		}
	}

	function mount() {
		if (document.getElementById('lap-panel')) return;

		readColours();

		toggle = document.createElement('button');
		toggle.id = 'lap-toggle';
		toggle.type = 'button';
		toggle.innerHTML =
			'<span class="lap-chevron">&#9664;</span>' +
			'<span class="lap-dot lap-idle"></span>' +
			'<span>Status</span>';

		panel = document.createElement('div');
		panel.id = 'lap-panel';

		document.body.appendChild(toggle);
		document.body.appendChild(panel);

		toggle.addEventListener('click', function () {
			setOpen(!panel.classList.contains('lap-open'));
		});

		clearInterval(ticker);
		ticker = setInterval(tick, 1000);

		// Open on first visit; after that, whatever was chosen last wins.
		var stored = null;
		try {
			stored = localStorage.getItem(STORE_KEY);
		} catch (e) {
			/* storage blocked */
		}

		setOpen(stored === null ? true : stored === '1');
	}

	// Only mount once signed in - the proxy needs a session.
	function start() {
		api('/ollama/api/tags')
			.then(mount)
			.catch(function () {
				setTimeout(start, 4000);
			});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', start);
	} else {
		start();
	}
})();
