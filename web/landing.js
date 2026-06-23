import { getCurrentUser, getOnboarding, signup, updateOnboarding } from "./storage.js";
import { ONBOARDING_STEPS, ONBOARDING_VERSION } from "./onboarding-config.js";

const ui = {
  heroStartButton: document.getElementById("heroStartButton"),
  finalSignupButton: document.getElementById("finalSignupButton"),
  heroSignupCard: document.getElementById("heroSignupCard"),
  landingIntro: document.getElementById("landingIntro"),
  landingIntroCanvas: document.getElementById("landingIntroCanvas"),
  landingContent: document.getElementById("landingContent"),
  signupTitle: document.getElementById("signupTitle"),
  signupLead: document.getElementById("signupLead"),
  landingSignupForm: document.getElementById("landingSignupForm"),
  landingDisplayName: document.getElementById("landingDisplayName"),
  landingEmail: document.getElementById("landingEmail"),
  landingPassword: document.getElementById("landingPassword"),
  landingSignupButton: document.getElementById("landingSignupButton"),
  landingSignupFeedback: document.getElementById("landingSignupFeedback"),
  landingSignedInState: document.getElementById("landingSignedInState"),
  landingSignedInCopy: document.getElementById("landingSignedInCopy"),
  landingOpenOnboardingButton: document.getElementById("landingOpenOnboardingButton"),
  onboardingOverlay: document.getElementById("onboardingOverlay"),
  onboardingScrim: document.getElementById("onboardingScrim"),
  onboardingPeek: document.getElementById("onboardingPeek"),
  onboardingPeekText: document.getElementById("onboardingPeekText"),
  onboardingStepCount: document.getElementById("onboardingStepCount"),
  onboardingProgress: document.getElementById("onboardingProgress"),
  onboardingTitle: document.getElementById("onboardingTitle"),
  onboardingHelper: document.getElementById("onboardingHelper"),
  onboardingForm: document.getElementById("onboardingForm"),
  onboardingFeedback: document.getElementById("onboardingFeedback"),
  backOnboardingButton: document.getElementById("backOnboardingButton"),
  skipOnboardingButton: document.getElementById("skipOnboardingButton"),
  nextOnboardingButton: document.getElementById("nextOnboardingButton"),
  minimizeOnboardingButton: document.getElementById("minimizeOnboardingButton"),
  closeOnboardingButton: document.getElementById("closeOnboardingButton"),
};

let currentUser = null;
let onboardingState = {
  status: "pending",
  currentStep: 0,
  answers: {},
  version: ONBOARDING_VERSION,
};
let currentStepIndex = 0;
let saveTimer = null;

const INTRO_FRAME_CONFIG = Object.freeze({
  basePath: "/static/assets/scrollanimation/",
  prefix: "Pippit_0522_MomentusLogoCloud",
  count: 147,
  extension: ".jpg",
  padLength: 3,
  scrubEnd: 0.72,
  revealStart: 0.3,
});

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const clamp01 = (value) => clamp(value, 0, 1);
const easeOutCubic = (value) => 1 - (1 - value) ** 3;

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const setFeedback = (element, message = "", tone = "") => {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("success-text", tone === "success");
  element.classList.toggle("error-text", tone === "error");
};

const describeOnboardingStatus = (status) => {
  if (status === "completed") {
    return "Your setup is complete. You can reopen it anytime to adjust your profile.";
  }
  if (status === "skipped") {
    return "Your answers are saved as you go. Come back anytime to finish setup.";
  }
  return "Finish the quick setup to tailor the app to your training style.";
};

const clampStepIndex = (value) => Math.min(Math.max(Number(value || 0), 0), ONBOARDING_STEPS.length - 1);

const setSignupLoading = (loading) => {
  if (!ui.landingSignupButton) return;
  ui.landingSignupButton.classList.toggle("is-loading", loading);
  ui.landingSignupButton.disabled = loading;
};

const updateOverlayRoute = (overlayOpen) => {
  const nextPath = overlayOpen ? "/onboarding" : "/";
  if (window.location.pathname !== nextPath) {
    window.history.replaceState({}, "", nextPath);
  }
};

const scrollToSignup = () => {
  ui.heroSignupCard?.scrollIntoView({ behavior: "smooth", block: "center" });
  if (!currentUser) {
    setTimeout(() => ui.landingDisplayName?.focus(), 250);
  }
};

const openOnboardingOverlay = ({ minimized = false } = {}) => {
  if (!currentUser || !ui.onboardingOverlay) return;
  ui.onboardingOverlay.classList.add("is-open");
  ui.onboardingOverlay.classList.toggle("is-minimized", minimized);
  ui.onboardingOverlay.setAttribute("aria-hidden", minimized ? "true" : "false");
  document.body.classList.add("landing-onboarding-open");
  updateOverlayRoute(true);
  renderOnboardingStep();
};

const minimizeOnboardingOverlay = () => {
  if (!ui.onboardingOverlay) return;
  ui.onboardingOverlay.classList.add("is-open", "is-minimized");
  ui.onboardingOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("landing-onboarding-open");
  updateOverlayRoute(false);
};

const closeOnboardingOverlay = () => {
  if (!ui.onboardingOverlay) return;
  ui.onboardingOverlay.classList.remove("is-open", "is-minimized");
  ui.onboardingOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("landing-onboarding-open");
  updateOverlayRoute(false);
};

const setupLandingIntro = () => {
  if (!ui.landingIntro || !ui.landingIntroCanvas || !ui.landingContent) return;

  const canvas = ui.landingIntroCanvas;
  const context = canvas.getContext("2d");
  if (!context) return;

  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const heroRevealTargets = [...new Set([...document.querySelectorAll(".hero [data-reveal]"), ui.heroSignupCard].filter(Boolean))];
  const frameStates = new Array(INTRO_FRAME_CONFIG.count).fill(0);
  const frameImages = new Array(INTRO_FRAME_CONFIG.count).fill(null);

  let scrollRaf = 0;
  let preloadTimer = 0;
  let preloadCursor = 1;
  let currentTargetFrame = 0;
  let currentProgress = 0;
  let currentMode = reducedMotionQuery.matches ? "reduced" : "animated";
  let heroRevealed = false;

  const setRootVar = (name, value) => document.body.style.setProperty(name, value);

  const buildFrameUrl = (index) =>
    `${INTRO_FRAME_CONFIG.basePath}${INTRO_FRAME_CONFIG.prefix}${String(index).padStart(INTRO_FRAME_CONFIG.padLength, "0")}${INTRO_FRAME_CONFIG.extension}`;

  const ensureHeroReveal = () => {
    if (heroRevealed) return;
    heroRevealed = true;
    heroRevealTargets.forEach((node) => node.classList.add("is-visible"));
  };

  const syncCanvasResolution = () => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height };
  };

  const drawCoverFrame = (image) => {
    if (!image) return;
    const { width, height } = syncCanvasResolution();
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) return;

    context.clearRect(0, 0, width, height);

    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const offsetX = (width - drawWidth) / 2;
    const offsetY = (height - drawHeight) / 2;

    context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
  };

  const getBestLoadedFrameIndex = (preferredIndex) => {
    if (frameStates[preferredIndex] === 2) return preferredIndex;
    for (let offset = 1; offset < INTRO_FRAME_CONFIG.count; offset += 1) {
      const lower = preferredIndex - offset;
      if (lower >= 0 && frameStates[lower] === 2) return lower;
      const upper = preferredIndex + offset;
      if (upper < INTRO_FRAME_CONFIG.count && frameStates[upper] === 2) return upper;
    }
    return -1;
  };

  const renderFrame = (preferredIndex = currentTargetFrame) => {
    const resolvedIndex = getBestLoadedFrameIndex(preferredIndex);
    if (resolvedIndex === -1) return;
    drawCoverFrame(frameImages[resolvedIndex]);
  };

  const requestFrame = (index) => {
    if (index < 0 || index >= INTRO_FRAME_CONFIG.count || frameStates[index] !== 0) return;

    frameStates[index] = 1;
    const image = new Image();
    image.decoding = "async";

    image.addEventListener(
      "load",
      () => {
        frameStates[index] = 2;
        frameImages[index] = image;
        if (index === 0 || index === currentTargetFrame || (currentMode === "reduced" && index === INTRO_FRAME_CONFIG.count - 1)) {
          renderFrame(index);
        }
      },
      { once: true }
    );

    image.addEventListener(
      "error",
      () => {
        frameStates[index] = -1;
      },
      { once: true }
    );

    image.src = buildFrameUrl(index);
  };

  const scheduleProgressivePreload = () => {
    if (currentMode === "reduced" || preloadTimer || preloadCursor >= INTRO_FRAME_CONFIG.count) return;

    const pump = () => {
      preloadTimer = 0;
      let queued = 0;

      while (preloadCursor < INTRO_FRAME_CONFIG.count && queued < 2) {
        requestFrame(preloadCursor);
        preloadCursor += 1;
        queued += 1;
      }

      if (preloadCursor < INTRO_FRAME_CONFIG.count) {
        preloadTimer = window.setTimeout(pump, 40);
      }
    };

    pump();
  };

  const updateIntroState = (progress) => {
    currentProgress = clamp01(progress);
    const revealProgress =
      currentProgress <= INTRO_FRAME_CONFIG.revealStart
        ? 0
        : clamp01((currentProgress - INTRO_FRAME_CONFIG.revealStart) / (1 - INTRO_FRAME_CONFIG.revealStart));
    const exitProgress =
      currentProgress <= INTRO_FRAME_CONFIG.scrubEnd
        ? 0
        : clamp01((currentProgress - INTRO_FRAME_CONFIG.scrubEnd) / (1 - INTRO_FRAME_CONFIG.scrubEnd));
    const easedReveal = easeOutCubic(revealProgress);
    const easedExit = easeOutCubic(exitProgress);
    const contentOpacity = clamp01(easedReveal * 1.16);
    const contentShift = Math.round((1 - easedReveal) * 34);

    setRootVar("--intro-progress", currentProgress.toFixed(4));
    setRootVar("--intro-exit-progress", exitProgress.toFixed(4));
    setRootVar("--intro-content-opacity", contentOpacity.toFixed(4));
    setRootVar("--intro-content-shift", `${contentShift}px`);
    setRootVar("--intro-canvas-scale", `${(1 + easedExit * 0.24).toFixed(4)}`);
    setRootVar("--intro-canvas-opacity", `${(1 - easedExit).toFixed(4)}`);
    setRootVar("--intro-canvas-blur", `${(easedExit * 14).toFixed(2)}px`);
    setRootVar("--intro-overlay-opacity", `${(0.16 + easedExit * 0.44).toFixed(4)}`);
    setRootVar("--bg-scale", `${(1.08 + easedExit * 0.03).toFixed(4)}`);
    setRootVar("--bg-shift", `${Math.round(currentProgress * -42)}px`);
    setRootVar("--bg-opacity", `${(0.34 + easedExit * 0.1).toFixed(4)}`);
    setRootVar("--bg-blur", `${(1 - easedExit) * 0.4}px`);

    if (revealProgress > 0.04) ensureHeroReveal();
    document.body.classList.toggle("landing-intro-complete", currentProgress >= 0.995);
  };

  const updateAnimatedFrame = () => {
    scrollRaf = 0;
    const scrollableDistance = Math.max(ui.landingIntro.offsetHeight - window.innerHeight, 1);
    const introTop = ui.landingIntro.getBoundingClientRect().top;
    const progress = clamp01(-introTop / scrollableDistance);
    const scrubProgress = clamp01(progress / INTRO_FRAME_CONFIG.scrubEnd);
    const targetFrame = Math.min(
      INTRO_FRAME_CONFIG.count - 1,
      Math.round(scrubProgress * (INTRO_FRAME_CONFIG.count - 1))
    );

    currentTargetFrame = targetFrame;
    updateIntroState(progress);
    requestFrame(targetFrame);
    renderFrame(targetFrame);
  };

  const scheduleAnimatedUpdate = () => {
    if (currentMode !== "animated" || scrollRaf) return;
    scrollRaf = window.requestAnimationFrame(updateAnimatedFrame);
  };

  const applyReducedMotionState = () => {
    currentMode = "reduced";
    document.body.classList.remove("landing-intro-active");
    document.body.classList.add("landing-intro-reduced-motion", "landing-intro-complete");
    window.clearTimeout(preloadTimer);
    preloadTimer = 0;
    currentTargetFrame = INTRO_FRAME_CONFIG.count - 1;
    requestFrame(currentTargetFrame);
    updateIntroState(1);
    ensureHeroReveal();
    renderFrame(currentTargetFrame);
  };

  const applyAnimatedState = () => {
    currentMode = "animated";
    document.body.classList.remove("landing-intro-reduced-motion");
    document.body.classList.add("landing-intro-active");
    requestFrame(0);
    renderFrame(0);
    scheduleProgressivePreload();
    updateAnimatedFrame();
  };

  requestFrame(0);

  if (reducedMotionQuery.matches) {
    applyReducedMotionState();
  } else {
    applyAnimatedState();
  }

  const handleViewportChange = () => {
    renderFrame();
    scheduleAnimatedUpdate();
  };

  const handleMotionPreferenceChange = (event) => {
    if (event.matches) {
      applyReducedMotionState();
      return;
    }
    document.body.classList.remove("landing-intro-complete");
    applyAnimatedState();
  };

  window.addEventListener("scroll", scheduleAnimatedUpdate, { passive: true });
  window.addEventListener("resize", handleViewportChange, { passive: true });
  window.addEventListener("orientationchange", handleViewportChange);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) handleViewportChange();
  });

  if (typeof reducedMotionQuery.addEventListener === "function") {
    reducedMotionQuery.addEventListener("change", handleMotionPreferenceChange);
  } else if (typeof reducedMotionQuery.addListener === "function") {
    reducedMotionQuery.addListener(handleMotionPreferenceChange);
  }
};

const updateSignedInCard = () => {
  if (!ui.landingSignupForm || !ui.landingSignedInState) return;
  const signedIn = Boolean(currentUser);
  ui.landingSignupForm.hidden = signedIn;
  ui.landingSignedInState.hidden = !signedIn;

  if (!signedIn) {
    ui.signupTitle.textContent = "Create your account";
    ui.signupLead.textContent = "Start with your account, then finish onboarding in the floating setup panel.";
    return;
  }

  const status = onboardingState.status || currentUser.onboardingStatus || "pending";
  ui.signupTitle.textContent = `Welcome, ${currentUser.displayName}`;
  ui.signupLead.textContent = "Your account is ready.";
  ui.landingSignedInCopy.textContent = describeOnboardingStatus(status);
  ui.landingOpenOnboardingButton.querySelector("span").textContent =
    status === "completed" ? "Edit onboarding" : "Resume onboarding";
}

const buildChoiceField = (step, value) => `
  <fieldset class="choice-group onboarding-field">
    <legend>${escapeHtml(step.label)}</legend>
    <div class="choice-grid">
      ${step.options
        .map(
          (option) => `
            <label class="choice-pill">
              <input type="radio" name="${escapeHtml(step.id)}" value="${escapeHtml(option)}" ${value === option ? "checked" : ""} />
              <span>${escapeHtml(option)}</span>
            </label>
          `
        )
        .join("")}
    </div>
  </fieldset>
`;

const buildSelectField = (step, value) => `
  <label class="onboarding-field">
    <span>${escapeHtml(step.label)}</span>
    <select name="${escapeHtml(step.id)}">
      <option value="">Select</option>
      ${step.options
        .map(
          (option) =>
            `<option value="${escapeHtml(option)}" ${value === option ? "selected" : ""}>${escapeHtml(option)}</option>`
        )
        .join("")}
    </select>
  </label>
`;

const buildTextField = (step, value) => `
  <label class="onboarding-field">
    <span>${escapeHtml(step.label)}</span>
    <input
      name="${escapeHtml(step.id)}"
      type="text"
      value="${escapeHtml(value || "")}"
      placeholder="${escapeHtml(step.placeholder || "")}"
      ${step.required ? "required" : ""}
    />
  </label>
`;

const buildTextareaField = (step, value) => `
  <label class="onboarding-field">
    <span>${escapeHtml(step.label)}</span>
    <textarea name="${escapeHtml(step.id)}" rows="5" placeholder="${escapeHtml(step.placeholder || "")}">${escapeHtml(
      value || ""
    )}</textarea>
  </label>
`;

const renderStepField = (step) => {
  const value = onboardingState.answers?.[step.id] ?? "";
  if (step.type === "choice") return buildChoiceField(step, value);
  if (step.type === "select") return buildSelectField(step, value);
  if (step.type === "textarea") return buildTextareaField(step, value);
  return buildTextField(step, value);
};

const getCurrentStep = () => ONBOARDING_STEPS[currentStepIndex];

const readStepValue = (step) => {
  if (!ui.onboardingForm) return "";
  if (step.type === "choice") {
    return ui.onboardingForm.querySelector(`input[name="${step.id}"]:checked`)?.value || "";
  }
  return ui.onboardingForm.querySelector(`[name="${step.id}"]`)?.value?.trim() || "";
};

const validateStep = (step) => {
  const value = readStepValue(step);
  if (step.required && !value) {
    setFeedback(ui.onboardingFeedback, "Pick an option before moving on.", "error");
    return false;
  }
  onboardingState.answers = {
    ...(onboardingState.answers || {}),
    [step.id]: value,
  };
  setFeedback(ui.onboardingFeedback, "");
  return true;
};

const persistOnboarding = async (status = onboardingState.status || "pending") => {
  onboardingState = await updateOnboarding({
    status,
    currentStep: currentStepIndex,
    answers: onboardingState.answers || {},
    version: onboardingState.version || ONBOARDING_VERSION,
  });
  onboardingState.version = onboardingState.version || ONBOARDING_VERSION;
  if (currentUser) currentUser.onboardingStatus = onboardingState.status;
  updateSignedInCard();
  ui.onboardingPeekText.textContent =
    onboardingState.status === "completed"
      ? "Onboarding complete"
      : `Resume from step ${clampStepIndex(onboardingState.currentStep) + 1}`;
  return onboardingState;
};

const scheduleAutosave = () => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    const step = getCurrentStep();
    if (!step) return;
    onboardingState.answers = {
      ...(onboardingState.answers || {}),
      [step.id]: readStepValue(step),
    };
    try {
      await persistOnboarding("pending");
      setFeedback(ui.onboardingFeedback, "Saved", "success");
    } catch (error) {
      setFeedback(ui.onboardingFeedback, error.message || "Could not save right now.", "error");
    }
  }, 320);
};

const renderOnboardingStep = () => {
  const step = getCurrentStep();
  if (!step || !ui.onboardingForm) return;
  const total = ONBOARDING_STEPS.length;
  ui.onboardingStepCount.textContent = `Step ${currentStepIndex + 1} of ${total}`;
  ui.onboardingProgress.style.width = `${((currentStepIndex + 1) / total) * 100}%`;
  ui.onboardingTitle.textContent = step.label;
  ui.onboardingHelper.textContent = step.helper || "Your answers save automatically.";
  ui.onboardingForm.innerHTML = renderStepField(step);
  ui.backOnboardingButton.disabled = currentStepIndex === 0;
  ui.nextOnboardingButton.querySelector("span").textContent = currentStepIndex === total - 1 ? "Finish" : "Next";
  setFeedback(ui.onboardingFeedback, "");

  ui.onboardingForm.querySelectorAll("input, select, textarea").forEach((field) => {
    field.addEventListener("input", scheduleAutosave);
    field.addEventListener("change", scheduleAutosave);
  });
};

const loadOnboardingState = async () => {
  onboardingState = await getOnboarding();
  onboardingState.version = onboardingState.version || ONBOARDING_VERSION;
  onboardingState.answers = onboardingState.answers || {};
  currentStepIndex = clampStepIndex(onboardingState.currentStep);
  updateSignedInCard();
};

const handleSignupSubmit = async (event) => {
  event.preventDefault();
  setSignupLoading(true);
  setFeedback(ui.landingSignupFeedback, "");

  try {
    const result = await signup({
      displayName: ui.landingDisplayName.value.trim(),
      email: ui.landingEmail.value.trim(),
      password: ui.landingPassword.value,
    });
    currentUser = result.user;
    ui.landingSignupForm.reset();
    await loadOnboardingState();
    setFeedback(ui.landingSignupFeedback, "Account created. Finish your setup below.", "success");
    openOnboardingOverlay();
  } catch (error) {
    setFeedback(ui.landingSignupFeedback, error.message || "Sign up failed.", "error");
  } finally {
    setSignupLoading(false);
  }
};

const bindOnboardingControls = () => {
  ui.backOnboardingButton?.addEventListener("click", async () => {
    const step = getCurrentStep();
    if (step) validateStep(step);
    currentStepIndex = clampStepIndex(currentStepIndex - 1);
    await persistOnboarding("pending");
    renderOnboardingStep();
  });

  ui.nextOnboardingButton?.addEventListener("click", async () => {
    const step = getCurrentStep();
    if (!step || !validateStep(step)) return;

    const isLastStep = currentStepIndex === ONBOARDING_STEPS.length - 1;
    try {
      if (isLastStep) {
        await persistOnboarding("completed");
        setFeedback(ui.onboardingFeedback, "Setup complete.", "success");
        window.setTimeout(() => closeOnboardingOverlay(), 300);
      } else {
        currentStepIndex = clampStepIndex(currentStepIndex + 1);
        await persistOnboarding("pending");
        renderOnboardingStep();
      }
    } catch (error) {
      setFeedback(ui.onboardingFeedback, error.message || "Could not save right now.", "error");
    }
  });

  ui.skipOnboardingButton?.addEventListener("click", async () => {
    try {
      const step = getCurrentStep();
      if (step) {
        onboardingState.answers = {
          ...(onboardingState.answers || {}),
          [step.id]: readStepValue(step),
        };
      }
      await persistOnboarding("skipped");
      minimizeOnboardingOverlay();
      setFeedback(ui.onboardingFeedback, "Setup saved for later.", "success");
    } catch (error) {
      setFeedback(ui.onboardingFeedback, error.message || "Could not save right now.", "error");
    }
  });

  ui.minimizeOnboardingButton?.addEventListener("click", () => minimizeOnboardingOverlay());
  ui.closeOnboardingButton?.addEventListener("click", () => minimizeOnboardingOverlay());
  ui.onboardingScrim?.addEventListener("click", () => minimizeOnboardingOverlay());
  ui.onboardingPeek?.addEventListener("click", () => openOnboardingOverlay());
};

const setupRevealAnimations = () => {
  document.body.classList.add("landing-motion-ready");
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add("is-visible");
      });
    },
    { threshold: 0.18 }
  );
  document.querySelectorAll("[data-reveal]").forEach((node) => observer.observe(node));
};

const setupSpotlights = () => {
  document.querySelectorAll("[data-spotlight]").forEach((node) => {
    node.addEventListener("pointermove", (event) => {
      const rect = node.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      node.style.setProperty("--spotlight-x", `${x}%`);
      node.style.setProperty("--spotlight-y", `${y}%`);
      node.classList.add("is-interacting");
    });
    node.addEventListener("pointerleave", () => node.classList.remove("is-interacting"));
  });
};

const bindPageControls = () => {
  ui.landingSignupForm?.addEventListener("submit", handleSignupSubmit);

  ui.heroStartButton?.addEventListener("click", () => {
    if (currentUser) {
      openOnboardingOverlay();
      return;
    }
    scrollToSignup();
  });

  ui.finalSignupButton?.addEventListener("click", () => {
    if (currentUser) {
      if (onboardingState.status === "completed") {
        window.location.href = "/app";
      } else {
        openOnboardingOverlay();
      }
      return;
    }
    scrollToSignup();
  });

  ui.landingOpenOnboardingButton?.addEventListener("click", async () => {
    if (!currentUser) return;
    await loadOnboardingState();
    openOnboardingOverlay();
  });
};

const init = async () => {
  setupRevealAnimations();
  setupLandingIntro();
  setupSpotlights();
  bindPageControls();
  bindOnboardingControls();

  currentUser = await getCurrentUser();
  if (currentUser) {
    await loadOnboardingState();
  } else if (window.location.pathname === "/onboarding") {
    setFeedback(ui.landingSignupFeedback, "Create your account first to begin onboarding.", "error");
    updateOverlayRoute(false);
  }

  updateSignedInCard();

  if (currentUser && window.location.pathname === "/onboarding") {
    openOnboardingOverlay();
  }
};

init();
