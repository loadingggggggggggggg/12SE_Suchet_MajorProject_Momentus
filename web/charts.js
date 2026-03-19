const setupCanvas = (canvas) => {
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  return { ctx, width: rect.width, height: rect.height };
};

const animate = (duration, draw) => {
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    draw(progress);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

const renderLineChart = (canvas, series, keys, colors, options = {}) => {
  const setup = setupCanvas(canvas);
  if (!setup) return;
  const { ctx, width, height } = setup;
  const padding = 24;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const maxValue = Math.max(
    1,
    ...series.flatMap((point) => keys.map((key) => Number(point[key] || 0)))
  );

  animate(550, (t) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f8f6f2";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = padding + (chartHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    if (options.showYAxis) {
      const ticks = options.yAxisTicks || 4;
      ctx.strokeStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      ctx.moveTo(padding, padding);
      ctx.lineTo(padding, height - padding);
      ctx.stroke();

      ctx.fillStyle = "#4a4a4a";
      ctx.font = "10px Space Grotesk, sans-serif";
      for (let i = 0; i <= ticks; i += 1) {
        const y = padding + (chartHeight / ticks) * i;
        const value = Math.round((maxValue / ticks) * (ticks - i));
        ctx.fillText(`${value}`, 4, y + 3);
      }

      if (options.yAxisLabel) {
        ctx.fillStyle = "#4a4a4a";
        ctx.font = "600 10px Space Grotesk, sans-serif";
        ctx.fillText(options.yAxisLabel, 4, 12);
      }
    }

    keys.forEach((key, idx) => {
      ctx.strokeStyle = colors[idx];
      ctx.lineWidth = 2;
      ctx.beginPath();
      series.forEach((point, i) => {
        const x = padding + (chartWidth / Math.max(series.length - 1, 1)) * i;
        const rawValue = Number(point[key] || 0);
        const y = padding + chartHeight - (rawValue / maxValue) * chartHeight * t;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      series.forEach((point, i) => {
        const x = padding + (chartWidth / Math.max(series.length - 1, 1)) * i;
        const rawValue = Number(point[key] || 0);
        const y = padding + chartHeight - (rawValue / maxValue) * chartHeight * t;
        ctx.fillStyle = colors[idx];
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();

        if (options.showValues) {
          const formatter = options.valueFormatter || ((value) => `${value}`);
          ctx.font = "10px Space Grotesk, sans-serif";
          ctx.fillText(formatter(rawValue, key, point), x + 6, y - 6);
        }
      });
    });

    const labelFilter = options.labelFilter || (() => true);
    const labelFormatter = options.labelFormatter || ((point) => point.label || "");
    ctx.fillStyle = "#4a4a4a";
    ctx.font = "11px Space Grotesk, sans-serif";
    series.forEach((point, i) => {
      if (!labelFilter(point, i, series)) return;
      const x = padding + (chartWidth / Math.max(series.length - 1, 1)) * i;
      const label = labelFormatter(point, i, series);
      ctx.fillText(label, x - 8, height - 6);
    });
  });
};

const renderPieChart = (canvas, data, colors, options = {}) => {
  const setup = setupCanvas(canvas);
  if (!setup) return;
  const { ctx, width, height } = setup;
  const radius = Math.min(width, height) * 0.35;
  const centerX = width / 2;
  const centerY = height / 2 + 10;
  const total = Math.max(1, data.reduce((sum, slice) => sum + slice.value, 0));

  animate(550, (t) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f8f6f2";
    ctx.fillRect(0, 0, width, height);

    let startAngle = -Math.PI / 2;
    data.forEach((slice, index) => {
      const sliceAngle = (slice.value / total) * Math.PI * 2 * t;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.fillStyle = colors[index % colors.length];
      ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
      ctx.fill();
      startAngle += sliceAngle;
    });

    ctx.fillStyle = "#4a4a4a";
    ctx.font = "11px Space Grotesk, sans-serif";
    data.forEach((slice, index) => {
      ctx.fillStyle = colors[index % colors.length];
      ctx.fillRect(12, 12 + index * 16, 8, 8);
      ctx.fillStyle = "#4a4a4a";
      ctx.fillText(`${slice.label} (${slice.value})`, 24, 20 + index * 16);
    });

    if (options.caption) {
      ctx.fillStyle = "#1f1f1f";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.font = "600 12px Space Grotesk, sans-serif";
      ctx.fillText(options.caption, width - 12, height - 10);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }
  });
};

const renderRingChart = (canvas, metrics, options = {}) => {
  const setup = setupCanvas(canvas);
  if (!setup) return;
  const { ctx, width, height } = setup;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.32;
  const thickness = 12;
  const gap = 2;
  const entries = Object.entries(metrics);
  const colors = ["#d65a31", "#ef9d38", "#6abf8f", "#6e8bd8"];

  animate(550, (t) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f8f6f2";
    ctx.fillRect(0, 0, width, height);

    entries.forEach(([key, value], index) => {
      const ratio = value.target ? Math.min(value.value / value.target, 1) : 0;
      const start = -Math.PI / 2 + index * 0.4;
      const end = start + Math.PI * 1.3;
      ctx.strokeStyle = "rgba(0,0,0,0.08)";
      ctx.lineWidth = thickness;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius - index * (thickness + gap), start, end);
      ctx.stroke();

      ctx.strokeStyle = colors[index % colors.length];
      ctx.lineWidth = thickness;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius - index * (thickness + gap), start, start + (end - start) * ratio * t);
      ctx.stroke();

      ctx.fillStyle = "#4a4a4a";
      ctx.font = "600 12px Space Grotesk, sans-serif";
      ctx.fillText(`${key}: ${value.value}/${value.target}`, 14, 18 + index * 18);
    });

    if (options.centerText) {
      ctx.fillStyle = "#1f1f1f";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "600 14px Space Grotesk, sans-serif";
      ctx.fillText(options.centerText, centerX, centerY);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }
  });
};

export { renderLineChart, renderPieChart, renderRingChart };
