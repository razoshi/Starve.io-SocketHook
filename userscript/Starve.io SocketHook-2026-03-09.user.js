// ==UserScript==
// @name         Starve.io SocketHook
// @namespace    https://tampermonkey.net/
// @version      2026-03-09
// @description  try to take over the world!
// @author       razoshi
// @match        *://*.starve.io/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=starve.io
// @run-at       document-start
// @grant        none
// @allIframes   true
// @license      MIT
// ==/UserScript==

new Proxy(window, { set: (_, prop, val) => { window[prop] = val; return true; }, deleteProperty: (_, prop) => { delete window[prop]; return true; } });
window.log = console.log;
console.info = console.log = () => {};
const { log } = window;

(function () {
    "use strict";

    const _apply = Reflect.apply;
    const _getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const _defineProperty = Object.defineProperty;
    const scopeList = new WeakSet();

    function decodePacket(data) {
        if (typeof data === "string") {
            try { return JSON.parse(data); } catch { return data; }
        }
        if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
            return new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer, data.byteOffset ?? 0, data.byteLength);
        }
        return data;
    }

    function logPacket(dir, data) {
        const arrow = dir === "out" ? "↑ outgoing:" : "↓ incoming:";
        const decoded = decodePacket(data);
        log(arrow);
        log("  ↓ raw:    ", (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) ? new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer) : data);
        log("  ↓ decoded:", decoded);
    }

    function hookWindow(win) {
        if (!win || scopeList.has(win)) return;
        scopeList.add(win);

        const wsProto = win.WebSocket.prototype;
        const originalSend = wsProto.send;

        wsProto.send = new Proxy(originalSend, {
            apply(target, thisArg, args) {
                logPacket("out", args[0]);
                return _apply(target, thisArg, args);
            }
        });

        const msgDesc = _getOwnPropertyDescriptor(wsProto, "onmessage");
        if (msgDesc && msgDesc.set) {
            _defineProperty(wsProto, "onmessage", {
                set(handler) {
                    const wrapped = new Proxy(handler, {
                        apply(target, thisArg, args) {
                            logPacket("in", args[0].data);
                            return _apply(target, thisArg, args);
                        }
                    });
                    return msgDesc.set.call(this, wrapped);
                },
                get() { return msgDesc.get.call(this); },
                configurable: true
            });
        }

        const originalAEL = wsProto.addEventListener;
        wsProto.addEventListener = new Proxy(originalAEL, {
            apply(target, thisArg, args) {
                const [type, listener, options] = args;
                if (type === "message" && typeof listener === "function") {
                    const wrapped = function (event) {
                        logPacket("in", event.data);
                        return listener.apply(this, arguments);
                    };
                    return _apply(target, thisArg, [type, wrapped, options]);
                }
                return _apply(target, thisArg, args);
            }
        });

        const toStringOld = win.Function.prototype.toString;
        win.Function.prototype.toString = new Proxy(toStringOld, {
            apply(target, thisArg, args) {
                if (thisArg === wsProto.send) return toStringOld.call(originalSend);
                if (thisArg === wsProto.addEventListener) return toStringOld.call(originalAEL);
                return _apply(target, thisArg, args);
            }
        });

        log("attached to window");
    }

    function getScope(scope) {
        if (!scope) return;
        try {
            hookWindow(scope);

            const _createElement = scope.document.createElement;
            scope.document.createElement = new Proxy(_createElement, {
                apply(target, thisArg, args) {
                    const el = _apply(target, thisArg, args);
                    if (typeof args[0] === "string" && args[0].toLowerCase() === "iframe") {
                        el.addEventListener("load", () => {
                            try { if (el.contentWindow) getScope(el.contentWindow); } catch {}
                        });
                        try {
                            const cwDesc = _getOwnPropertyDescriptor(scope.HTMLIFrameElement.prototype, "contentWindow");
                            if (cwDesc) {
                                _defineProperty(el, "contentWindow", {
                                    get() { const w = cwDesc.get.call(this); if (w) getScope(w); return w; },
                                    configurable: true
                                });
                            }
                        } catch {}
                    }
                    return el;
                }
            });
        } catch {}
    }

    getScope(window);
})();