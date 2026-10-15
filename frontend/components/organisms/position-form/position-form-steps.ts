export type PositionFormStepKey = "details" | "description" | "application" | "pipeline" | "review";

export type PositionFormStep = {
  key: PositionFormStepKey;
  name: string;
  description: string;
};

export const POSITION_FORM_STEPS: PositionFormStep[] = [
  {
    key: "details",
    name: "Details",
    description: "The essentials — title, where it's based, and compensation.",
  },
  {
    key: "description",
    name: "Description",
    description: "Write the public job description candidates will read.",
  },
  {
    key: "application",
    name: "Application",
    description: "Choose how people apply and what the form collects.",
  },
  {
    key: "pipeline",
    name: "Pipeline",
    description: "Pick the stages and automations for this position.",
  },
  {
    key: "review",
    name: "Review",
    description: "Check everything, then save as draft or publish.",
  },
];

export const POSITION_EDIT_STEPS: PositionFormStep[] = POSITION_FORM_STEPS.filter(
  (step) => step.key !== "review",
);

export function positionFormStep(key: PositionFormStepKey): PositionFormStep {
  const step = POSITION_FORM_STEPS.find((candidate) => candidate.key === key);
  if (!step) throw new Error(`Unknown position form step: ${key}`);
  return step;
}
