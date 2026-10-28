// Shown while a page's queries run on navigation. Same shapes as the pages, no numbers.
export default function Loading() {
  return (
    <main aria-busy="true" aria-label="Loading">
      <div className="stats">
        {[0, 1, 2, 3].map((i) => (
          <div className="stat" key={i}>
            <div className="skel" style={{ height: 10, width: '55%' }} />
            <div className="skel" style={{ height: 20, width: '35%', marginTop: 10 }} />
          </div>
        ))}
      </div>
      <div className="card">
        {[90, 70, 80, 60, 75].map((w, i) => (
          <div className="skel skel-line" key={i} style={{ width: `${w}%` }} />
        ))}
      </div>
    </main>
  );
}
