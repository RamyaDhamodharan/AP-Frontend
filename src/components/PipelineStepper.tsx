import { Check } from "lucide-react";

export type PipelineStage = "received" | "reading" | "verifying" | "matching" | "outcome";

export interface PipelineStepperProps {
  status?: string | null;
  stage?: PipelineStage | number;
  compact?: boolean;
  className?: string;
}

export function inferPipelineStage(status?: string | null): number {
  if (!status) return 1;
  const s = status.toLowerCase();
  if (s === "uploaded" || s === "received" || s === "pending") return 1;
  if (s === "ocr_processing" || s === "reading" || s === "parsing") return 2;
  if (s === "extracting" || s === "verifying" || s === "needs_data_review") return 3;
  if (s === "matching" || s === "po_matching") return 4;
  if (s === "ready_to_pay" || s === "needs_review" || s === "on_hold" || s === "approved" || s === "rejected" || s === "failed") {
    return 5;
  }
  if (s === "processing") return 2;
  return 3;
}

export function PipelineStepper({
  status,
  stage,
  compact = false,
  className = "",
}: PipelineStepperProps) {
  const currentStep = typeof stage === "number"
    ? stage
    : stage
    ? ({ received: 1, reading: 2, verifying: 3, matching: 4, outcome: 5 } as const)[stage] || 1
    : inferPipelineStage(status);

  const isOutcomeReady = status === "ready_to_pay" || status === "approved";
  const isOutcomeReview = status === "needs_review" || status === "needs_vendor_review" || status === "on_hold";
  const isOutcomeFailed = status === "failed" || status === "rejected";

  const outcomeLabel = isOutcomeReady
    ? "Ready to Pay"
    : isOutcomeReview
    ? "Needs Review"
    : isOutcomeFailed
    ? "Failed"
    : "Ready / Review";

  const outcomeTone = isOutcomeReady
    ? "success"
    : isOutcomeReview
    ? "warning"
    : isOutcomeFailed
    ? "error"
    : "neutral";

  const steps = [
    { num: 1, label: "Received" },
    { num: 2, label: "Reading" },
    { num: 3, label: "Verifying" },
    { num: 4, label: "Matching" },
    { num: 5, label: outcomeLabel, tone: outcomeTone },
  ];

  return (
    <div
      className={`pipeline-stepper ${compact ? "pipeline-stepper-compact" : ""} ${className}`.trim()}
      aria-label="Document processing workflow steps"
    >
      <div className="pipeline-track">
        {steps.map((step, idx) => {
          const isCompleted = step.num < currentStep || (step.num === 5 && currentStep === 5);
          const isActive = step.num === currentStep && !(step.num === 5 && currentStep === 5);
          const isPending = step.num > currentStep;

          const stepClass = isCompleted
            ? "step-completed"
            : isActive
            ? "step-active"
            : "step-pending";

          return (
            <div key={step.num} className={`pipeline-step ${stepClass}`}>
              <div className="pipeline-node-container">
                <div
                  className={`pipeline-node ${step.tone ? `step-tone-${step.tone}` : ""}`}
                  aria-current={isActive ? "step" : undefined}
                >
                  {isCompleted ? (
                    <span className="pipeline-check" aria-label={`Completed ${step.label}`}>
                      <Check size={compact ? 11 : 13} strokeWidth={2.5} />
                    </span>
                  ) : (
                    <span className="pipeline-num">{step.num}</span>
                  )}
                </div>
                {!compact && <span className="pipeline-label">{step.label}</span>}
              </div>

              {idx < steps.length - 1 && (
                <div className={`pipeline-line ${step.num < currentStep ? "line-filled" : ""}`}>
                  <span className="pipeline-line-progress" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
