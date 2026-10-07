import ApplicationServices
import AppKit
import Foundation

func attr(_ e: AXUIElement, _ a: String) -> CFTypeRef? {
    var v: CFTypeRef?
    return AXUIElementCopyAttributeValue(e, a as CFString, &v) == .success ? v : nil
}
func str(_ e: AXUIElement, _ a: String) -> String { (attr(e, a) as? String) ?? "" }
func children(_ e: AXUIElement) -> [AXUIElement] { (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }
func frame(_ e: AXUIElement) -> CGRect? {
    guard let p = attr(e, kAXPositionAttribute), let s = attr(e, kAXSizeAttribute) else { return nil }
    var pt = CGPoint.zero, sz = CGSize.zero
    AXValueGetValue(p as! AXValue, .cgPoint, &pt); AXValueGetValue(s as! AXValue, .cgSize, &sz)
    return CGRect(origin: pt, size: sz)
}
func label(_ e: AXUIElement) -> String {
    let parts = [str(e, kAXTitleAttribute), str(e, kAXDescriptionAttribute), str(e, kAXValueAttribute), str(e, "AXPlaceholderValue")]
    return parts.filter { !$0.isEmpty }.joined(separator: " | ")
}
func walk(_ e: AXUIElement, depth: Int, maxDepth: Int, budget: inout Int, _ visit: (AXUIElement, Int) -> Void) {
    if budget <= 0 || depth > maxDepth { return }
    budget -= 1
    visit(e, depth)
    for c in children(e) { walk(c, depth: depth + 1, maxDepth: maxDepth, budget: &budget, visit) }
}
func appEl(_ pid: pid_t) -> AXUIElement { AXUIElementCreateApplication(pid) }
func windows(_ pid: pid_t) -> [AXUIElement] { (attr(appEl(pid), kAXWindowsAttribute) as? [AXUIElement]) ?? [] }
func fmt(_ r: CGRect?) -> String { r.map { "(\(Int($0.origin.x)),\(Int($0.origin.y)) \(Int($0.size.width))x\(Int($0.size.height)))" } ?? "" }

let a = CommandLine.arguments
guard a.count >= 2 else { print("usage: ax <cmd> ..."); exit(2) }
let cmd = a[1]
func pidArg(_ i: Int) -> pid_t { pid_t(Int32(a[i])!) }

func keyEvent(_ code: CGKeyCode, flags: CGEventFlags, pid: pid_t?) {
    for down in [true, false] {
        let ev = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)!
        ev.flags = flags
        if let pid = pid { ev.postToPid(pid) } else { ev.post(tap: .cghidEventTap) }
        usleep(40_000)
    }
}
func mouse(_ type: CGEventType, _ p: CGPoint) {
    let ev = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: .left)!
    ev.post(tap: .cghidEventTap)
}

switch cmd {
case "windows":
    let pid = pidArg(2)
    for (i, w) in windows(pid).enumerated() { print(i, str(w, kAXTitleAttribute), fmt(frame(w)), "role=\(str(w, kAXRoleAttribute))") }
    if let info = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] {
        for w in info where (w[kCGWindowOwnerPID as String] as? Int32) == pid && (w[kCGWindowLayer as String] as? Int) == 0 {
            print("CGWindowID", w[kCGWindowNumber as String] ?? "", w[kCGWindowName as String] ?? "", w[kCGWindowBounds as String] ?? "")
        }
    }
case "dump":
    let pid = pidArg(2); let maxDepth = a.count > 3 ? Int(a[3])! : 30
    var budget = 4000
    for w in windows(pid) { walk(w, depth: 0, maxDepth: maxDepth, budget: &budget) { e, d in
        let l = label(e); let r = str(e, kAXRoleAttribute)
        if !l.isEmpty || ["AXButton", "AXWebArea", "AXPopUpButton", "AXCheckBox", "AXTextField", "AXLink", "AXRadioButton", "AXHeading"].contains(r) {
            print(String(repeating: " ", count: min(d, 20)) + r + " [" + l.prefix(110) + "] " + fmt(frame(e)))
        } } }
case "setvalue":
    // ax setvalue <pid> <needle> <value> : set AXValue on the first matching element
    let pid = pidArg(2); let needle = a[3]; let value = a[4]
    var budget = 6000; var hits: [AXUIElement] = []
    for w in windows(pid) { walk(w, depth: 0, maxDepth: 40, budget: &budget) { e, _ in
        if label(e).contains(needle) && str(e, kAXRoleAttribute) == "AXTextField" { hits.append(e) } } }
    if hits.isEmpty { print("NOT FOUND:", needle); exit(1) }
    let r = AXUIElementSetAttributeValue(hits[0], kAXValueAttribute as CFString, value as CFString)
    print("setvalue", needle, "->", r == .success ? "ok" : "err \(r.rawValue)")
case "find", "press", "frame", "center":
    let pid = pidArg(2); let needle = a[3]; let roleFilter = a.count > 4 ? a[4] : ""
    var budget = 6000; var hits: [AXUIElement] = []
    for w in windows(pid) { walk(w, depth: 0, maxDepth: 40, budget: &budget) { e, _ in
        if label(e).contains(needle) && (roleFilter.isEmpty || str(e, kAXRoleAttribute) == roleFilter) { hits.append(e) } } }
    if cmd == "find" { for h in hits { print(str(h, kAXRoleAttribute), "[" + label(h).prefix(110) + "]", fmt(frame(h))) }; print("hits:", hits.count) }
    else if hits.isEmpty { print("NOT FOUND:", needle); exit(1) }
    else if cmd == "press" { let r = AXUIElementPerformAction(hits[0], kAXPressAction as CFString); print("press", needle, "->", r == .success ? "ok" : "err \(r.rawValue)") }
    else if let f = frame(hits[0]) { print(Int(f.midX), Int(f.midY)) }
case "setsize":
    let pid = pidArg(2); let w = windows(pid)[0]
    var sz = CGSize(width: Double(a[3])!, height: Double(a[4])!)
    let v = AXValueCreate(.cgSize, &sz)!
    print("setsize ->", AXUIElementSetAttributeValue(w, kAXSizeAttribute as CFString, v).rawValue)
case "setpos":
    let pid = pidArg(2); let w = windows(pid)[0]
    var p = CGPoint(x: Double(a[3])!, y: Double(a[4])!)
    let v = AXValueCreate(.cgPoint, &p)!
    print("setpos ->", AXUIElementSetAttributeValue(w, kAXPositionAttribute as CFString, v).rawValue)
case "focused":
    let pid = pidArg(2)
    if let f = attr(appEl(pid), kAXFocusedUIElementAttribute) { let e = f as! AXUIElement; print(str(e, kAXRoleAttribute), "[" + label(e) + "]", fmt(frame(e))) } else { print("no focus element") }
case "activate":
    let pid = pidArg(2)
    NSRunningApplication(processIdentifier: pid)?.activate(options: [.activateAllWindows])
    usleep(600_000); print("frontmost:", NSWorkspace.shared.frontmostApplication?.localizedName ?? "?")
case "key":   // ax key <keycode> [cmd|shift|alt|ctrl,...] [pid]
    let code = CGKeyCode(UInt16(a[2])!); var fl: CGEventFlags = []
    if a.count > 3 { for f in a[3].split(separator: ",") { switch f { case "cmd": fl.insert(.maskCommand); case "shift": fl.insert(.maskShift); case "alt": fl.insert(.maskAlternate); case "ctrl": fl.insert(.maskControl); default: break } } }
    keyEvent(code, flags: fl, pid: a.count > 4 ? pidArg(4) : nil); print("key", code)
case "click":  // real HID pointer click
    let p = CGPoint(x: Double(a[2])!, y: Double(a[3])!)
    mouse(.mouseMoved, p); usleep(150_000); mouse(.leftMouseDown, p); usleep(60_000); mouse(.leftMouseUp, p); print("click", p)
case "move":
    mouse(.mouseMoved, CGPoint(x: Double(a[2])!, y: Double(a[3])!)); print("moved")
case "scroll": // ax scroll x y dy  (negative scrolls content down)
    let p = CGPoint(x: Double(a[2])!, y: Double(a[3])!); mouse(.mouseMoved, p); usleep(150_000)
    let dy = Int32(a[4])!
    for _ in 0..<6 { CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0)!.post(tap: .cghidEventTap); usleep(60_000) }
    print("scroll", dy)
case "scrollpx": // ax scrollpx x y dy : pixel-unit wheel events
    let p = CGPoint(x: Double(a[2])!, y: Double(a[3])!); mouse(.mouseMoved, p); usleep(200_000)
    let dy = Int32(a[4])!
    for _ in 0..<10 { let e = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0)!; e.location = p; e.post(tap: .cghidEventTap); usleep(30_000) }
    print("scrollpx", dy)
case "cursor":
    let l = NSEvent.mouseLocation; print("cursor", Int(l.x), Int(l.y))
default: print("unknown cmd"); exit(2)
}
