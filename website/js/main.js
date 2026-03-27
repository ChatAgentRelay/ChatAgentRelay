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

  /* Terminal typing effect on hero */
  var heroTerminal = document.querySelector(".hero-terminal .terminal-body");
  if (heroTerminal) {
    var lines = heroTerminal.querySelectorAll("[data-type]");
    var delay = 0;
    lines.forEach(function (line) {
      var text = line.textContent;
      line.textContent = "";
      line.style.visibility = "visible";
      var charDelay = 25;
      for (var i = 0; i < text.length; i++) {
        (function (idx, d) {
          setTimeout(function () {
            line.textContent = text.substring(0, idx + 1);
          }, d + idx * charDelay);
        })(i, delay);
      }
      delay += text.length * charDelay + 300;
    });
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

  /* Copy to clipboard for code blocks */
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
