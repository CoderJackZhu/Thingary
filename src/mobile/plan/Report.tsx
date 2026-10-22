import { useState } from "react";
import { shareReport } from "../me/files";
import type { BasicCapabilities, PlanningSources } from "../../plan";
import { currentReportInput } from "../../planning-report/current-adapter";
import {
  copyText,
  printableHtml,
  exportFileName,
  parseReportInput,
} from "../../planning-report/model";
import {
  Button,
  Card,
  ErrorState,
  NavBar,
  Notice,
  Switch,
  FormRow,
} from "../ui";
/** Frozen snapshot: refreshes never replace the body while the report is open. */
export default function Report({
  sources,
  caps,
  onClose,
}: {
  sources: PlanningSources;
  caps: BasicCapabilities;
  onClose: () => void;
}) {
  const [snapshot] = useState(() => {
    try {
      const parsed = parseReportInput(
        currentReportInput(sources, caps, sources.today),
      );
      return parsed.ok
        ? { report: parsed.report, error: "" }
        : { report: null, error: "报告数据无法识别，请返回重新生成。" };
    } catch (e) {
      return {
        report: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });
  const [privacy, setPrivacy] = useState(true),
    [notice, setNotice] = useState(""),
    [exporting, setExporting] = useState(false);
  if (!snapshot.report)
    return (
      <div className="m-page mp-page">
        <NavBar title="当前报告" back={{ label: "目标", onClick: onClose }} />
        <ErrorState message={snapshot.error} />
      </div>
    );
  const report = snapshot.report;
  async function copy() {
    try {
      await navigator.clipboard.writeText(copyText(report, privacy));
      setNotice("已复制当前摘要。");
    } catch {
      setNotice("复制失败，请重试。");
    }
  }
  async function download() {
    if (exporting) return;
    setExporting(true);
    try {
      setNotice(await shareReport(exportFileName(report, privacy), printableHtml(report, { privacy })));
    } catch {
      setNotice("导出失败，请重试。");
    } finally { setExporting(false); }
  }
  return (
    <div className="m-page mp-page">
      <NavBar title="当前报告" back={{ label: "目标", onClick: onClose }} />
      <Card>
        <FormRow label="隐藏金额和私人名称">
          <Switch
            label="报告隐私模式"
            checked={privacy}
            onChange={setPrivacy}
          />
        </FormRow>
        <p className="mp-muted">
          固定于生成时的已保存资料。关闭后重新生成可取得最新结果。
        </p>
      </Card>
      <Card>
        <pre className="mp-report">{copyText(report, privacy)}</pre>
      </Card>
      <div className="mp-actions">
        <Button onClick={() => void copy()}>复制摘要</Button>
        <Button variant="primary" disabled={exporting} onClick={() => void download()}>
          {exporting ? '正在导出…' : '导出当前报告'}
        </Button>
      </div>
      {notice && <Notice>{notice}</Notice>}
    </div>
  );
}
