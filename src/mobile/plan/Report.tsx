import { useState } from "react";
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
    [notice, setNotice] = useState("");
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
  function download() {
    try {
      const blob = new Blob([printableHtml(report, { privacy })], {
          type: "text/html;charset=utf-8",
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = exportFileName(report, privacy);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("已生成可打印的 HTML 报告。");
    } catch {
      setNotice("导出失败，请重试。");
    }
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
        <Button variant="primary" onClick={download}>
          导出当前报告
        </Button>
      </div>
      <Notice>
        当前导出可打印的 HTML 文件。iOS 系统分享入口尚未接入，原生分享和 PDF
        导出未验证。
      </Notice>
      {notice && <Notice>{notice}</Notice>}
    </div>
  );
}
