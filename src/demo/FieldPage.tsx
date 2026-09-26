type FieldPageProps = {
  onBack: () => void;
};

export function FieldPage({ onBack }: FieldPageProps) {
  return (
    <section className="field-page" aria-label="Field">
      <div className="field-scene" />
      <button type="button" className="field-back" onClick={onBack}>
        Back
      </button>
    </section>
  );
}
