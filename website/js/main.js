/* Chat Agent Relay website — Interactions + GA4 */
(function () {
  "use strict";

  /* Mobile nav toggle */
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      links.classList.toggle("open");
    });
  }

  /* Scroll reveal */
  var reveals = document.querySelectorAll(".reveal");
  if (reveals.length && "IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );
    reveals.forEach(function (el) { observer.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("visible"); });
  }

  /* GA4 event tracking */
  function trackEvent(name, params) {
    if (typeof gtag === "function") {
      gtag("event", name, params || {});
    }
  }

  /* Track CTA clicks */
  document.querySelectorAll("[data-track]").forEach(function (el) {
    el.addEventListener("click", function () {
      trackEvent("cta_click", {
        cta_name: el.getAttribute("data-track"),
        cta_url: el.href || ""
      });
    });
  });

  /* Track outbound links */
  document.querySelectorAll('a[href^="http"]').forEach(function (el) {
    if (el.hostname !== window.location.hostname) {
      el.addEventListener("click", function () {
        trackEvent("outbound_click", { url: el.href });
      });
    }
  });

  /* Track scroll depth */
  var scrollMarks = [25, 50, 75, 100];
  var scrollFired = {};
  window.addEventListener("scroll", function () {
    var pct = Math.round(
      ((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight) * 100
    );
    scrollMarks.forEach(function (mark) {
      if (pct >= mark && !scrollFired[mark]) {
        scrollFired[mark] = true;
        trackEvent("scroll_depth", { depth: mark });
      }
    });
  });

  /* Docs and mobile sidebar toggle */
  var sidebarToggle = document.querySelector(".sidebar-toggle");
  var sidebar = document.querySelector(".doc-sidebar");
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener("click", function () {
      sidebar.classList.toggle("open");
    });
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function detectLanguage(text) {
    if (/^(curl|car|git|bun|cd |export |npm |yarn |pnpm )/m.test(text) || /\s\\$/m.test(text)) return "bash";
    if (/^(rules:|\s+-\s+action:|[A-Za-z0-9_-]+:\s)/m.test(text) && /:\s/m.test(text) && !/[{};]/.test(text)) return "yaml";
    if (/^\s*[\[{]/.test(text) || /"[A-Za-z0-9_\-.]+"\s*:/m.test(text)) return "json";
    if (/^(upstream|server|location|proxy_set_header|listen)\b/m.test(text)) return "nginx";
    if (/(interface|const|let|import |export |async |Promise<)/.test(text)) return "typescript";
    return "text";
  }

  function highlightCode(text, language) {
    var html = escapeHtml(text);

    if (language === "bash") {
      return text
        .split("\n")
        .map(function (line) {
          if (/^#.*$/.test(line)) {
            return '<span class="code-token-comment">' + escapeHtml(line) + '</span>';
          }

          var match = line.match(/^(\$\s*)?([a-z][\w:-]*)(.*)$/i);
          if (!match) {
            return escapeHtml(line).replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="code-token-string">$1</span>');
          }

          var prompt = escapeHtml(match[1] || "");
          var command = '<span class="code-token-command">' + escapeHtml(match[2]) + '</span>';
          var rest = escapeHtml(match[3] || "").replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="code-token-string">$1</span>');
          return prompt + command + rest;
        })
        .join("\n");
    }

    if (language === "json") {
      html = html.replace(/("(?:[^"\\]|\\.)*")\s*:/g, '<span class="code-token-key">$1</span>:');
      html = html.replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span class="code-token-string">$1</span>');
      html = html.replace(/:\s*(-?\d+(?:\.\d+)?)/g, ': <span class="code-token-number">$1</span>');
      html = html.replace(/:\s*(true|false|null)/g, ': <span class="code-token-keyword">$1</span>');
      return html;
    }

    if (language === "yaml") {
      html = html.replace(/^(\s*#.*)$/gm, '<span class="code-token-comment">$1</span>');
      html = html.replace(/^(\s*)([A-Za-z0-9_.-]+:)/gm, '$1<span class="code-token-key">$2</span>');
      html = html.replace(/:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, ': <span class="code-token-string">$1</span>');
      html = html.replace(/:\s*(-?\d+(?:\.\d+)?|true|false|null)/g, ': <span class="code-token-number">$1</span>');
      return html;
    }

    if (language === "nginx") {
      html = html.replace(/^(\s*#.*)$/gm, '<span class="code-token-comment">$1</span>');
      html = html.replace(/^(\s*)(upstream|server|location)\b/gm, '$1<span class="code-token-keyword">$2</span>');
      html = html.replace(/^(\s*)([a-z_]+)\b/gm, '$1<span class="code-token-directive">$2</span>');
      html = html.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="code-token-string">$1</span>');
      return html;
    }

    if (language === "typescript") {
      html = html.replace(/\b(interface|type|const|let|import|from|export|async|await|return|if)\b/g, '<span class="code-token-keyword">$1</span>');
      html = html.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="code-token-string">$1</span>');
      html = html.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="code-token-number">$1</span>');
      return html;
    }

    return html;
  }

  function addCopyButton(pre, text) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy-button";
    button.textContent = "Copy";
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      navigator.clipboard.writeText(text).then(function () {
        button.textContent = "Copied!";
        button.classList.add("copied");
        setTimeout(function () {
          button.textContent = "Copy";
          button.classList.remove("copied");
        }, 1500);
        trackEvent("code_copy", { snippet: text.substring(0, 50) });
      });
    });
    pre.appendChild(button);
  }

  document.querySelectorAll(".doc-content pre code, .article pre code").forEach(function (block) {
    var pre = block.parentElement;
    if (!pre) return;
    var text = block.textContent.replace(/\s+$/, "");
    var language = detectLanguage(text);
    pre.classList.add("code-block");
    pre.setAttribute("data-language", language);
    block.innerHTML = highlightCode(text, language);
    addCopyButton(pre, text);
  });

  /* Copy to clipboard for terminal blocks */
  document.querySelectorAll(".terminal").forEach(function (term) {
    term.style.cursor = "pointer";
    term.title = "Click to copy";
    term.addEventListener("click", function () {
      var body = term.querySelector(".terminal-body");
      if (!body) return;
      var text = body.textContent.replace(/^\$\s*/gm, "").trim();
      navigator.clipboard.writeText(text).then(function () {
        var title = term.querySelector(".terminal-title");
        if (title) {
          var orig = title.textContent;
          title.textContent = "Copied!";
          setTimeout(function () { title.textContent = orig; }, 1500);
        }
        trackEvent("code_copy", { snippet: text.substring(0, 50) });
      });
    });
  });
})();
