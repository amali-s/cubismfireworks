type SubpageProps = {
  onBack: () => void;
};

function BackButton({ onBack }: SubpageProps) {
  return (
    <button type="button" onClick={onBack}>
      Back
    </button>
  );
}

export function GalleryPage({ onBack }: SubpageProps) {
  return (
    <section className="subpage">
      <h2>Gallery</h2>
      <p>These planes were cut from the picture you just opened.</p>
      <p>They hang here until you are ready to leave the room.</p>
      <BackButton onBack={onBack} />
    </section>
  );
}

export function ArchivePage({ onBack }: SubpageProps) {
  return (
    <section className="subpage">
      <h2>Archive</h2>
      <p>The picture is kept flat, the way it was before the cubes moved.</p>
      <p>Nothing in this room is put back together.</p>
      <BackButton onBack={onBack} />
    </section>
  );
}

export function StudioPage({ onBack }: SubpageProps) {
  return (
    <section className="subpage">
      <h2>Studio</h2>
      <p>New color waits on the bench as simple overlapping shapes.</p>
      <p>Step back when you want the menu in view again.</p>
      <BackButton onBack={onBack} />
    </section>
  );
}
