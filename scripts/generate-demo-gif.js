import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { GifWriter } from 'omggif';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUTPUT_DIR = path.resolve('docs/assets');
const OUTPUT_GIF = path.join(OUTPUT_DIR, 'npsp-demo.gif');
const TMP_DIR = path.resolve('/tmp/permforge-gif-frames');

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

// Terminal frame contents with realistic progressive typing and execution
const framesData = [
  // 1: Prompt
  {
    content: `
      <div class="line prompt-line">
        <span class="prompt-icon">➜</span>
        <span class="prompt-path">salesforce-npsp</span>
        <span class="prompt-git">(main)</span>
        <span class="cmd-text"><span class="cursor">▊</span></span>
      </div>
    `,
    delay: 60, // 0.6s
  },
  // 2: Typing command part 1
  {
    content: `
      <div class="line prompt-line">
        <span class="prompt-icon">➜</span>
        <span class="prompt-path">salesforce-npsp</span>
        <span class="prompt-git">(main)</span>
        <span class="cmd-text">permforge pipeline --run<span class="cursor">▊</span></span>
      </div>
    `,
    delay: 50,
  },
  // 3: Typing command part 2
  {
    content: `
      <div class="line prompt-line">
        <span class="prompt-icon">➜</span>
        <span class="prompt-path">salesforce-npsp</span>
        <span class="prompt-git">(main)</span>
        <span class="cmd-text">permforge pipeline --run --source profiles/ --cluster --strict<span class="cursor">▊</span></span>
      </div>
    `,
    delay: 80,
  },
  // 4: Launching pipeline
  {
    content: `
      <div class="line prompt-line">
        <span class="prompt-icon">➜</span>
        <span class="prompt-path">salesforce-npsp</span>
        <span class="prompt-git">(main)</span>
        <span class="cmd-text">permforge pipeline --run --source profiles/ --cluster --strict</span>
      </div>
      <div class="line header-title">🚀 <span class="bold cyan">PermForge Enterprise Migration Pipeline</span> <span class="dim">v1.2.0</span></div>
      <div class="line"><span class="yellow">⚡ Target Repository:</span> Salesforce Nonprofit Success Pack (NPSP)</div>
      <div class="line dim">Discovered 4 legacy profiles: NPSP_Standard_User, Admin, Standard, sysadmin_test</div>
      <div class="line mt"><span class="cyan">⟳</span> Running Stage 1/8: Profile Access & Technical Debt Audit...</div>
    `,
    delay: 70,
  },
  // 5: Stage 1 Audit & Stage 2 Cluster Done
  {
    content: `
      <div class="line prompt-line">
        <span class="prompt-icon">➜</span>
        <span class="prompt-path">salesforce-npsp</span>
        <span class="prompt-git">(main)</span>
        <span class="cmd-text">permforge pipeline --run --source profiles/ --cluster --strict</span>
      </div>
      <div class="line header-title">🚀 <span class="bold cyan">PermForge Enterprise Migration Pipeline</span> <span class="dim">v1.2.0</span></div>
      <div class="line"><span class="yellow">⚡ Target Repository:</span> Salesforce Nonprofit Success Pack (NPSP)</div>
      <div class="line dim">Discovered 4 legacy profiles: NPSP_Standard_User, Admin, Standard, sysadmin_test</div>
      <div class="line mt"><span class="green">✔ [STAGE 1: AUDIT]</span> Audited 4 profiles. Scanned 42 SObjects, 31 FLS fields, 173 system perms.</div>
      <div class="line"><span class="green">✔ [STAGE 2: CLUSTER]</span> <span class="bold">82% shared permission overlap detected!</span></div>
      <div class="line sub-item">↳ Extracted shared <span class="cyan">Standard_Employee_Baseline.permissionset-meta.xml</span></div>
      <div class="line sub-item">↳ Isolated 4 role deltas (Donations, Grants, Affiliations, System Admin)</div>
      <div class="line mt"><span class="cyan">⟳</span> Running Stage 3 & 4: Decomposition & Mathematical Parity Proof...</div>
    `,
    delay: 90,
  },
  // 6: Parity Verified & Stripping
  {
    content: `
      <div class="line prompt-line">
        <span class="prompt-icon">➜</span>
        <span class="prompt-path">salesforce-npsp</span>
        <span class="prompt-git">(main)</span>
        <span class="cmd-text">permforge pipeline --run --source profiles/ --cluster --strict</span>
      </div>
      <div class="line header-title">🚀 <span class="bold cyan">PermForge Enterprise Migration Pipeline</span> <span class="dim">v1.2.0</span></div>
      <div class="line mt"><span class="green">✔ [STAGE 1: AUDIT]</span> Audited 4 profiles. Scanned 42 SObjects, 31 FLS fields, 173 system perms.</div>
      <div class="line"><span class="green">✔ [STAGE 2: CLUSTER]</span> Extracted baseline &amp; modularized 4 persona PSGs.</div>
      <div class="line"><span class="green">✔ [STAGE 3: DECOMPOSE]</span> Generated domain Permission Sets for NPSP custom objects.</div>
      <div class="line"><span class="green">✔ [STAGE 4: VERIFY]</span> <span class="bold green">Mathematical Parity: 100.0% Bit-for-Bit Match (235/235 perms)</span></div>
      <div class="line sub-item">↳ SObjects: <span class="green">100%</span> | FLS: <span class="green">100%</span> | System Perms: <span class="green">100%</span> | Apex: <span class="green">100%</span></div>
      <div class="line"><span class="green">✔ [STAGE 5: STRIP]</span> Sanitized source profiles (layouts &amp; IP ranges preserved).</div>
      <div class="line mt"><span class="cyan">⟳</span> Running Stage 6, 7 & 8: User Access Policies, Rollout Plan &amp; Report...</div>
    `,
    delay: 100,
  },
  // 7: Summary Table Complete
  {
    content: `
      <div class="line prompt-line">
        <span class="prompt-icon">➜</span>
        <span class="prompt-path">salesforce-npsp</span>
        <span class="prompt-git">(main)</span>
        <span class="cmd-text">permforge pipeline --run --source profiles/ --cluster --strict</span>
      </div>
      <div class="table-container">
        <table class="cli-table">
          <thead>
            <tr><th>Stage</th><th>Status</th><th>Duration</th><th>Details</th></tr>
          </thead>
          <tbody>
            <tr><td class="bold">AUDIT</td><td><span class="badge-success">✔ SUCCESS</span></td><td>1ms</td><td>Audited 4 NPSP profiles. Avg Complexity: 40/100</td></tr>
            <tr><td class="bold">CLUSTER</td><td><span class="badge-success">✔ SUCCESS</span></td><td>2ms</td><td>Extracted Standard_Employee_Baseline + 4 deltas</td></tr>
            <tr><td class="bold">DECOMPOSE</td><td><span class="badge-success">✔ SUCCESS</span></td><td>1ms</td><td>Modularized 4 profiles into domain sets &amp; PSGs</td></tr>
            <tr><td class="bold">VERIFY</td><td><span class="badge-success">✔ SUCCESS</span></td><td>10ms</td><td>Access Parity: 100% (235/235 matched bit-for-bit)</td></tr>
            <tr><td class="bold">STRIP</td><td><span class="badge-success">✔ SUCCESS</span></td><td>4ms</td><td>Sanitized 4 profiles. Layouts &amp; IPs preserved</td></tr>
            <tr><td class="bold">UAP</td><td><span class="badge-success">✔ SUCCESS</span></td><td>2ms</td><td>Generated 4 User Access Policies (.userAccessPolicy)</td></tr>
            <tr><td class="bold">PLAN</td><td><span class="badge-success">✔ SUCCESS</span></td><td>3ms</td><td>Rollout CSVs, rollback scripts &amp; deploy sequences</td></tr>
            <tr><td class="bold">REPORT</td><td><span class="badge-success">✔ SUCCESS</span></td><td>8ms</td><td>Executive HTML Report: npsp-migration-report.html</td></tr>
          </tbody>
        </table>
      </div>
      <div class="summary-box">
        <div class="summary-line"><span class="bold">📊 Pipeline Summary:</span></div>
        <div class="summary-grid">
          <div>• Profiles Processed: <span class="cyan">4 (NPSP)</span></div>
          <div>• Permission Sets: <span class="green">6 created</span></div>
          <div>• Parity Score: <span class="green bold">100% (Bit-for-bit)</span></div>
          <div>• Execution Time: <span class="cyan">31ms</span></div>
        </div>
      </div>
      <div class="line finale"><span class="green bold">🎉 Migration Pipeline completed successfully! Zero access disruption guaranteed.</span></div>
    `,
    delay: 350, // 3.5s pause on final screen
  },
];

function buildHtml(innerContent) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #07090e;
    font-family: -apple-system, BlinkMacSystemFont, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 860px;
    height: 520px;
    overflow: hidden;
    padding: 16px;
  }
  .window {
    width: 100%;
    height: 100%;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .titlebar {
    height: 38px;
    background: #161b22;
    border-bottom: 1px solid #21262d;
    display: flex;
    align-items: center;
    padding: 0 14px;
    position: relative;
    user-select: none;
  }
  .buttons {
    display: flex;
    gap: 7px;
  }
  .dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
  }
  .dot-red { background: #ff5f56; }
  .dot-yellow { background: #ffbd2e; }
  .dot-green { background: #27c93f; }
  .title {
    position: absolute;
    left: 0; right: 0;
    text-align: center;
    color: #8b949e;
    font-size: 11.5px;
    font-weight: 500;
    letter-spacing: 0.2px;
  }
  .badge-repo {
    margin-left: auto;
    background: rgba(56, 189, 248, 0.12);
    color: #38bdf8;
    border: 1px solid rgba(56, 189, 248, 0.25);
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 10px;
  }
  .terminal-body {
    flex: 1;
    padding: 16px 18px;
    color: #e6edf3;
    font-size: 12px;
    line-height: 1.55;
    font-family: "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
    overflow: hidden;
  }
  .prompt-line {
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .prompt-icon { color: #2ea043; font-weight: bold; }
  .prompt-path { color: #58a6ff; font-weight: 600; }
  .prompt-git { color: #8b949e; }
  .cmd-text { color: #ffffff; font-weight: 600; }
  .cursor {
    color: #58a6ff;
    animation: blink 1s step-end infinite;
    margin-left: 2px;
  }
  .line { margin-bottom: 3px; }
  .sub-item { padding-left: 18px; color: #8b949e; font-size: 11.5px; }
  .header-title { font-size: 13.5px; font-weight: bold; margin-bottom: 4px; }
  .mt { margin-top: 8px; }
  .bold { font-weight: bold; }
  .cyan { color: #58a6ff; }
  .green { color: #3fb950; }
  .yellow { color: #d29922; }
  .dim { color: #8b949e; }
  
  .table-container { margin: 8px 0 10px 0; }
  .cli-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    border: 1px solid #30363d;
  }
  .cli-table th {
    background: #161b22;
    color: #8b949e;
    text-align: left;
    padding: 4px 8px;
    font-weight: 600;
    border-bottom: 1px solid #30363d;
  }
  .cli-table td {
    padding: 3px 8px;
    border-bottom: 1px solid #21262d;
    color: #c9d1d9;
  }
  .badge-success {
    background: rgba(46, 160, 67, 0.15);
    color: #3fb950;
    padding: 1px 5px;
    border-radius: 3px;
    font-weight: bold;
    font-size: 10px;
  }
  .summary-box {
    background: rgba(22, 27, 34, 0.8);
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 8px 12px;
    margin: 8px 0;
  }
  .summary-line { font-size: 11.5px; margin-bottom: 4px; }
  .summary-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    font-size: 11px;
    color: #c9d1d9;
  }
  .finale {
    margin-top: 6px;
    font-size: 12px;
  }
</style>
</head>
<body>
  <div class="window">
    <div class="titlebar">
      <div class="buttons">
        <div class="dot dot-red"></div>
        <div class="dot dot-yellow"></div>
        <div class="dot dot-green"></div>
      </div>
      <div class="title">zsh — permforge pipeline (Salesforce NPSP)</div>
      <div class="badge-repo">Salesforce NPSP DX</div>
    </div>
    <div class="terminal-body">
      ${innerContent}
    </div>
  </div>
</body>
</html>`;
}

console.log('🎬 Generating Demo GIF frames for Salesforce NPSP...');

const framePngPaths = [];

// 1. Render all frames to PNG via Chrome headless
for (let i = 0; i < framesData.length; i++) {
  const frameHtml = buildHtml(framesData[i].content);
  const htmlPath = path.join(TMP_DIR, `frame_${i}.html`);
  const pngPath = path.join(TMP_DIR, `frame_${i}.png`);
  fs.writeFileSync(htmlPath, frameHtml, 'utf-8');

  execFileSync(CHROME_PATH, [
    '--headless=new',
    '--disable-gpu',
    '--screenshot=' + pngPath,
    '--window-size=860,520',
    '--default-background-color=00000000',
    `file://${htmlPath}`,
  ]);

  framePngPaths.push(pngPath);
  console.log(`  ✔ Captured frame ${i + 1}/${framesData.length}`);
}

// 2. Read PNG frames and collect colors to build global palette
console.log('🎨 Quantizing frames and building GIF palette...');
const decodedFrames = framePngPaths.map((p) => {
  const buf = fs.readFileSync(p);
  return PNG.sync.read(buf);
});

const width = decodedFrames[0].width;
const height = decodedFrames[0].height;

// Collect all unique colors across all frames
const colorCountMap = new Map();

for (const frame of decodedFrames) {
  const data = frame.data;
  for (let i = 0; i < data.length; i += 4) {
    // Quantize 5 bits per channel to group very subtle antialiasing
    const r = data[i] & 0xf8;
    const g = data[i + 1] & 0xf8;
    const b = data[i + 2] & 0xf8;
    const key = (r << 16) | (g << 8) | b;
    colorCountMap.set(key, (colorCountMap.get(key) || 0) + 1);
  }
}

// Sort colors by frequency and take top 256
const sortedColors = Array.from(colorCountMap.entries())
  .sort((a, b) => b[1] - a[1])
  .slice(0, 256)
  .map((entry) => entry[0]);

while (sortedColors.length < 256) {
  sortedColors.push(0x000000);
}

// Quick nearest color lookup
function findNearestColorIndex(rgb) {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;

  let minDist = Infinity;
  let bestIdx = 0;

  for (let i = 0; i < sortedColors.length; i++) {
    const pal = sortedColors[i];
    const pr = (pal >> 16) & 0xff;
    const pg = (pal >> 8) & 0xff;
    const pb = pal & 0xff;

    const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (dist < minDist) {
      minDist = dist;
      bestIdx = i;
      if (dist === 0) break;
    }
  }
  return bestIdx;
}

// 3. Encode into animated GIF using GifWriter
console.log('🎞️ Assembling animated GIF...');
const gifBuffer = Buffer.alloc(width * height * decodedFrames.length + 1024 * 1024);
const writer = new GifWriter(gifBuffer, width, height, {
  palette: sortedColors,
  loop: 0, // loop forever
});

for (let i = 0; i < decodedFrames.length; i++) {
  const frame = decodedFrames[i];
  const delay = framesData[i].delay; // delay in 100ths of sec
  const indexed = new Uint8Array(width * height);

  let p = 0;
  for (let idx = 0; idx < frame.data.length; idx += 4) {
    const r = frame.data[idx] & 0xf8;
    const g = frame.data[idx + 1] & 0xf8;
    const b = frame.data[idx + 2] & 0xf8;
    const rgb = (r << 16) | (g << 8) | b;
    indexed[p++] = findNearestColorIndex(rgb);
  }

  writer.addFrame(0, 0, width, height, indexed, {
    palette: sortedColors,
    delay: delay,
  });
}

const finalGifLength = writer.end();
const finalGif = gifBuffer.subarray(0, finalGifLength);
fs.writeFileSync(OUTPUT_GIF, finalGif);

console.log(`🎉 Demo GIF generated successfully!`);
console.log(`  • Destination: ${OUTPUT_GIF}`);
console.log(`  • Dimensions: ${width}x${height}`);
console.log(`  • Frames: ${decodedFrames.length}`);
console.log(`  • File Size: ${(finalGif.length / 1024).toFixed(1)} KB`);
