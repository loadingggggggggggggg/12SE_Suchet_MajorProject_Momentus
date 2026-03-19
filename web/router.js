const routes = ["dashboard", "training", "nutrition", "recovery"];

const setActiveRoute = (route) => {
  routes.forEach((name) => {
    const screen = document.querySelector(`#screen-${name}`);
    const link = document.querySelector(`.nav-link[data-route="${name}"]`);
    if (screen) screen.classList.toggle("active", name === route);
    if (link) link.classList.toggle("active", name === route);
  });
};

const initRouter = (onRouteChange) => {
  const handleRoute = () => {
    const hash = window.location.hash.replace("#", "");
    const route = routes.includes(hash) ? hash : "dashboard";
    setActiveRoute(route);
    if (onRouteChange) onRouteChange(route);
  };

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      const route = link.dataset.route;
      window.location.hash = route;
    });
  });

  window.addEventListener("hashchange", handleRoute);
  handleRoute();
};

export { initRouter };
