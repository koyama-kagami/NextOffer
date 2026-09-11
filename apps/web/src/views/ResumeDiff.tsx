export default function Diff({ before, after }: { before: string; after: string }) {
  const a = before.split('\n'),
    b = after.split('\n');
  return (
    <div className="diff-columns">
      <div>
        <h4>原版本</h4>
        <pre>
          {a.map((line, i) => (
            <span className={line !== b[i] ? 'removed' : ''} key={i}>
              {line || ' '}
              <br />
            </span>
          ))}
        </pre>
      </div>
      <div>
        <h4>当前 / 建议版本</h4>
        <pre>
          {b.map((line, i) => (
            <span className={line !== a[i] ? 'added' : ''} key={i}>
              {line || ' '}
              <br />
            </span>
          ))}
        </pre>
      </div>
    </div>
  );
}
