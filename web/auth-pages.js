import { getCurrentUser, login, requestPasswordReset, resetPassword, signup } from "./storage.js";

const loginForm = document.getElementById("authLoginForm");
const signupForm = document.getElementById("authSignupForm");
const resetPasswordForm = document.getElementById("authResetPasswordForm");
const forgotPasswordForm = document.getElementById("forgotPasswordForm");
const forgotPasswordToggle = document.getElementById("forgotPasswordToggle");
const feedback = document.getElementById("authFeedback");
const forgotFeedback = document.getElementById("forgotFeedback");
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

const setForgotFeedback = (result = {}, tone = "") => {
  if (!forgotFeedback) return;
  forgotFeedback.classList.toggle("success-text", tone === "success");
  forgotFeedback.classList.toggle("error-text", tone === "error");
  if (tone === "success" && result?.devResetUrl) {
    forgotFeedback.innerHTML = `${escapeHtml(result.message || "Development reset link ready.")} <a href="${escapeHtml(
      result.devResetUrl
    )}">Open reset link</a>`;
    return;
  }
  forgotFeedback.textContent = result?.message || "";
};

const toggleForgotPasswordForm = () => {
  if (!forgotPasswordForm) return;
  const opening = forgotPasswordForm.hidden;
  forgotPasswordForm.hidden = !opening;
  forgotPasswordToggle.textContent = opening ? "Hide reset form" : "Forgot password?";
  if (opening) {
    document.getElementById("forgotPasswordEmail")?.focus();
  }
};

const init = async () => {
  const currentUser = await getCurrentUser();
  if (currentUser && !resetPasswordForm) {
    window.location.replace("/app");
    return;
  }

  forgotPasswordToggle?.addEventListener("click", () => {
    setForgotFeedback({}, "");
    const loginEmail = document.getElementById("authLoginEmail")?.value.trim() || "";
    const forgotEmail = document.getElementById("forgotPasswordEmail");
    if (loginEmail && forgotEmail && !forgotEmail.value) {
      forgotEmail.value = loginEmail;
    }
    toggleForgotPasswordForm();
  });

  forgotPasswordForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setForgotFeedback({}, "");
    try {
      const result = await requestPasswordReset({
        email: document.getElementById("forgotPasswordEmail")?.value.trim() || "",
      });
      setForgotFeedback(
        { message: result.message || "If that email exists, a reset link has been sent.", devResetUrl: result.devResetUrl },
        "success"
      );
      forgotPasswordForm.reset();
    } catch (error) {
      setForgotFeedback({ message: error.message || "Could not send reset email." }, "error");
    }
  });

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFeedback(feedback, "");
    try {
      await login({
        email: document.getElementById("authLoginEmail")?.value.trim(),
        password: document.getElementById("authLoginPassword")?.value || "",
      });
      window.location.replace("/app");
    } catch (error) {
      setFeedback(feedback, error.message || "Could not log in.", "error");
    }
  });

  signupForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFeedback(feedback, "");
    try {
      await signup({
        displayName: document.getElementById("authSignupDisplayName")?.value.trim(),
        email: document.getElementById("authSignupEmail")?.value.trim(),
        password: document.getElementById("authSignupPassword")?.value || "",
      });
      window.location.replace("/onboarding");
    } catch (error) {
      setFeedback(feedback, error.message || "Could not create account.", "error");
    }
  });

  resetPasswordForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFeedback(feedback, "");
    const token = new URLSearchParams(window.location.search).get("token") || "";
    if (!token) {
      setFeedback(feedback, "This reset link is missing its token.", "error");
      return;
    }
    const newPassword = document.getElementById("resetPasswordNew")?.value || "";
    const confirmPassword = document.getElementById("resetPasswordConfirm")?.value || "";
    if (newPassword !== confirmPassword) {
      setFeedback(feedback, "Passwords do not match.", "error");
      return;
    }
    try {
      const result = await resetPassword({ token, newPassword });
      resetPasswordForm.reset();
      setFeedback(feedback, result.message || "Password reset complete.", "success");
      window.setTimeout(() => {
        window.location.replace("/login");
      }, 900);
    } catch (error) {
      setFeedback(feedback, error.message || "Could not reset password.", "error");
    }
  });
};

init();
