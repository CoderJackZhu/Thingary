import { Component, createRef } from 'react';
import type { ReactNode } from 'react';
import { t } from './i18n.ts';

type Props = {
  children: ReactNode;
  resetKey?: unknown;
  onHome?: () => void;
  homeDisabled?: boolean;
};

export class ErrorBoundary extends Component<Props, { failed: boolean; key: unknown }> {
  state = { failed: false, key: this.props.resetKey };
  private heading = createRef<HTMLHeadingElement>();
  static getDerivedStateFromError() { return { failed: true }; }
  static getDerivedStateFromProps(props: Props, state: { key: unknown }) {
    return Object.is(props.resetKey, state.key) ? null : { failed: false, key: props.resetKey };
  }
  componentDidCatch() { this.heading.current?.focus(); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="empty page-error" role="alert">
      <h2 ref={this.heading} tabIndex={-1}>{t('这一页打不开')}</h2>
      <p>{t('显示页面时出现问题。可以重试；已提交但结果未知的操作仍需核对。')}</p>
      <button type="button" onClick={() => this.setState({ failed: false })}>{t('重试')}</button>
      {this.props.onHome && <button type="button" disabled={this.props.homeDisabled} onClick={this.props.onHome}>{t('返回总览')}</button>}
    </div>;
  }
}
