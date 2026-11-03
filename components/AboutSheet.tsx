import Sheet from "./Sheet";

// F11.
export default function AboutSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="About" onClose={onClose}>
      <div className="prose">
        <p>An explorable, annotated atlas of Venice as it was drawn between 1500 and 1847 — from Jacopo de&apos;Barbari&apos;s woodcut to the Combatti brothers&apos; survey.</p>
        <p>Turn on layers to see churches, bell towers, bridges, wells, islands and more traced on each map. Search a place to find every map it appears on.</p>
        <p>A project of the <a href="https://veniceprojectcenter.org" target="_blank" rel="noreferrer">Venice Project Center</a>.</p>
      </div>
    </Sheet>
  );
}
