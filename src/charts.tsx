import React from "react";

/**
 * Charts for the archive, as inline SVG.
 *
 * No library: these pages are opened from a file:// path on a NAS with no
 * network, so a CDN script tag would render an empty box. SVG that the browser
 * already knows how to draw always works.
 *
 * One hue throughout (--viz-series), because every chart here is a single
 * series - "how many messages" measured against time, hour, or person. A
 * second colour would imply a second thing being measured. Hover is native
 * <title>, which needs no JavaScript.
 */

export interface Datum {
  label: string;
  value: number;
  /** Overrides the hover text, which is otherwise "label: value". */
  title?: string;
  href?: string;
}

/**
 * The drawing is done in a 1000 x 176 box and scaled uniformly to fit.
 *
 * It used to be 100 units wide with preserveAspectRatio="none", which stretches
 * everything horizontally by ten - including the axis labels, which came out as
 * an unreadable smear. Uniform scaling keeps text text.
 */
const PLOT_WIDTH = 1000;
const PLOT_HEIGHT = 132;
/** Bars end in a 4px round, anchored flat to the baseline. */
const CAP = 4;
/** Two pixels of surface between neighbouring fills. */
const GAP = 2;

function niceMax(values: Array<number>): number {
  const max = Math.max(1, ...values);
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  return Math.ceil(max / magnitude) * magnitude;
}

export function formatCount(value: number): string {
  return value.toLocaleString("fi-FI").replace(/ /g, " ");
}

/** A bar with square feet and a rounded top, rather than a rounded rectangle. */
function barPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(CAP, width / 2, Math.max(0, height));
  if (height <= 0) return "";

  return [
    `M${x} ${y + height}`,
    `V${y + r}`,
    `Q${x} ${y} ${x + r} ${y}`,
    `H${x + width - r}`,
    `Q${x + width} ${y} ${x + width} ${y + r}`,
    `V${y + height}`,
    "Z",
  ].join(" ");
}

interface ColumnsProps {
  data: Array<Datum>;
  /** Show every nth label, for axes too crowded to label in full. */
  labelEvery?: number;
}

/** Vertical bars: a count per time bucket, in order. */
export const Columns: React.FunctionComponent<ColumnsProps> = ({
  data,
  labelEvery = 1,
}) => {
  const max = niceMax(data.map((d) => d.value));
  const width = PLOT_WIDTH / Math.max(1, data.length);

  return (
    <svg
      className="viz"
      viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT + 26}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
    >
      <line
        className="viz-axis"
        x1="0"
        y1={PLOT_HEIGHT}
        x2={PLOT_WIDTH}
        y2={PLOT_HEIGHT}
      />
      {data.map((datum, i) => {
        const height = (datum.value / max) * (PLOT_HEIGHT - 4);
        const x = i * width;
        const barWidth = Math.max(1, width - GAP);

        return (
          <g key={datum.label}>
            <path
              className="viz-mark"
              d={barPath(x, PLOT_HEIGHT - height, barWidth, height)}
            />
            <title>
              {datum.title || `${datum.label}: ${formatCount(datum.value)}`}
            </title>
            {i % labelEvery === 0 ? (
              <text
                className="viz-label"
                x={x + barWidth / 2}
                y={PLOT_HEIGHT + 17}
                textAnchor="middle"
              >
                {datum.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
};

/** Horizontal bars with the name and the number beside them: a ranking. */
export const Bars: React.FunctionComponent<{ data: Array<Datum> }> = ({
  data,
}) => {
  const max = niceMax(data.map((d) => d.value));

  return (
    <ul className="viz-bars">
      {data.map((datum) => (
        <li key={datum.label}>
          <span className="viz-bars-label">
            {datum.href ? <a href={datum.href}>{datum.label}</a> : datum.label}
          </span>
          <span className="viz-bars-track">
            <span
              className="viz-bars-fill"
              style={{ width: `${Math.max(1, (datum.value / max) * 100)}%` }}
            />
          </span>
          <span className="viz-bars-value">{formatCount(datum.value)}</span>
        </li>
      ))}
    </ul>
  );
};

/** Ten years of months: too many points for bars, so an area. */
export const Area: React.FunctionComponent<ColumnsProps> = ({
  data,
  labelEvery = 12,
}) => {
  const max = niceMax(data.map((d) => d.value));
  const step = PLOT_WIDTH / Math.max(1, data.length - 1);
  const y = (value: number) => PLOT_HEIGHT - (value / max) * (PLOT_HEIGHT - 4);
  const points = data.map((d, i) => `${i * step},${y(d.value)}`);

  return (
    <svg
      className="viz"
      viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT + 26}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
    >
      <line
        className="viz-axis"
        x1="0"
        y1={PLOT_HEIGHT}
        x2={PLOT_WIDTH}
        y2={PLOT_HEIGHT}
      />
      <polygon
        className="viz-area"
        points={`0,${PLOT_HEIGHT} ${points.join(" ")} ${PLOT_WIDTH},${PLOT_HEIGHT}`}
      />
      <polyline className="viz-line" points={points.join(" ")} />
      {data.map((datum, i) =>
        i % labelEvery === 0 ? (
          <text
            key={datum.label}
            className="viz-label"
            x={i * step}
            y={PLOT_HEIGHT + 17}
            textAnchor="middle"
          >
            {datum.label.slice(0, 4)}
          </text>
        ) : null,
      )}
      {data.map((datum, i) => (
        <rect
          key={`hit-${datum.label}`}
          x={Math.max(0, i * step - step / 2)}
          y="0"
          width={step}
          height={PLOT_HEIGHT}
          fill="transparent"
        >
          <title>{`${datum.label}: ${formatCount(datum.value)}`}</title>
        </rect>
      ))}
    </svg>
  );
};

interface FigureProps {
  title: string;
  note?: string;
  data: Array<Datum>;
  children?: React.ReactNode;
}

/**
 * A chart with its title, and the same numbers as a table underneath.
 *
 * The table is not a fallback - it is the accessible reading of the same data,
 * and it collapses so it costs nothing to anyone who does not want it.
 */
export const Figure: React.FunctionComponent<FigureProps> = ({
  title,
  note,
  data,
  children,
}) => (
  <figure className="viz-figure">
    <figcaption>
      {title}
      {note ? <span className="viz-note"> {note}</span> : null}
    </figcaption>
    {children}
    <details className="viz-table">
      <summary>Numbers</summary>
      <table>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.label}>
              <td>{datum.label}</td>
              <td className="viz-bars-value">{formatCount(datum.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  </figure>
);

/** A single number worth reading on its own. */
export const Tile: React.FunctionComponent<{
  label: string;
  value: string;
  hint?: string;
}> = ({ label, value, hint }) => (
  <div className="viz-tile">
    <div className="viz-tile-value">{value}</div>
    <div className="viz-tile-label">{label}</div>
    {hint ? <div className="viz-tile-hint">{hint}</div> : null}
  </div>
);
