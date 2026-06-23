const ONBOARDING_VERSION = 1;

const ONBOARDING_STEPS = [
  {
    id: "training_goal",
    step: 0,
    label: "Main goal",
    type: "choice",
    required: true,
    options: ["Build strength", "Build muscle", "Lose fat", "Improve performance"],
    helper: "Pick the outcome you care about most right now.",
  },
  {
    id: "experience_level",
    step: 1,
    label: "Experience",
    type: "choice",
    required: true,
    options: ["Beginner", "Intermediate", "Advanced", "Returning"],
    helper: "This helps shape volume, pacing, and education.",
  },
  {
    id: "training_days",
    step: 2,
    label: "Training days per week",
    type: "choice",
    required: true,
    options: ["2 days", "3 days", "4 days", "5+ days"],
    helper: "Choose what feels realistic for your week.",
  },
  {
    id: "training_style",
    step: 3,
    label: "Preferred style",
    type: "choice",
    required: true,
    options: ["Gym-based", "Home-based", "Minimal equipment", "Mixed"],
    helper: "You can change this later from your account.",
  },
  {
    id: "age_band",
    step: 4,
    label: "Age range",
    type: "select",
    required: false,
    options: ["Under 18", "18-24", "25-34", "35-44", "45-54", "55+"],
    helper: "Optional demographic info for future personalization.",
  },
  {
    id: "focus_notes",
    step: 5,
    label: "Anything else to keep in mind?",
    type: "textarea",
    required: false,
    placeholder: "Injuries, equipment limits, schedule notes, or preferences...",
    helper: "Keep it short for now. You can update it anytime.",
  },
];

export { ONBOARDING_VERSION, ONBOARDING_STEPS };
