// Reveal each element once as it enters the viewport.
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("in");
      io.unobserve(e.target);
    }
  },
  { rootMargin: "0px 0px -10% 0px" },
);
for (const el of document.querySelectorAll(".reveal")) io.observe(el);
