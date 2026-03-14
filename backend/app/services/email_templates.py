"""
HTML email templates for Vision Pro NVR notifications.
"""
from datetime import datetime
from typing import Dict, Any, Optional


# --- Color palette per event type ---
EVENT_COLORS = {
    "person": {"bg": "#1E40AF", "light": "#DBEAFE", "label": "Person Detected"},
    "vehicle": {"bg": "#B45309", "light": "#FEF3C7", "label": "Vehicle Detected"},
    "face_unknown": {"bg": "#DC2626", "light": "#FEE2E2", "label": "Unknown Face"},
    "face_known": {"bg": "#059669", "light": "#D1FAE5", "label": "Known Face"},
    "animal": {"bg": "#7C3AED", "light": "#EDE9FE", "label": "Animal Detected"},
    "potted plant": {"bg": "#65A30D", "light": "#ECFCCB", "label": "Object Detected"},
    "custom": {"bg": "#0891B2", "light": "#CFFAFE", "label": "Custom Detection"},
}

DEFAULT_COLOR = {"bg": "#6B7280", "light": "#F3F4F6", "label": "Event Detected"}


def _get_event_style(event_type: str) -> Dict[str, str]:
    """Get color scheme for an event type."""
    return EVENT_COLORS.get(event_type, DEFAULT_COLOR)


def _format_objects(detected_objects: list) -> str:
    """Format detected objects into HTML pills."""
    if not detected_objects:
        return "<span style='color:#9CA3AF;'>None</span>"
    pills = []
    for obj in detected_objects:
        name = obj.get("class", obj.get("className", "unknown")) if isinstance(obj, dict) else str(obj)
        pills.append(
            f"<span style='display:inline-block;background:#374151;color:#E5E7EB;"
            f"padding:3px 10px;border-radius:12px;font-size:12px;margin:2px 3px 2px 0;'>"
            f"{name}</span>"
        )
    return "".join(pills)


def _format_confidence(confidence: float) -> str:
    """Format confidence as a colored percentage."""
    pct = round(confidence * 100) if confidence <= 1 else round(confidence)
    if pct >= 80:
        color = "#10B981"
    elif pct >= 60:
        color = "#F59E0B"
    else:
        color = "#EF4444"
    return f"<span style='color:{color};font-weight:700;'>{pct}%</span>"


def render_event_email(event_data: Dict[str, Any], snapshot_cid: Optional[str] = None) -> str:
    """
    Render a full HTML email for a security event.

    Parameters
    ----------
    event_data : dict
        Keys: event_type, camera_name, confidence, timestamp (str or datetime),
              detected_objects (list), ai_summary, bounding_box (optional),
              face_name (optional), snapshot_url (optional)
    snapshot_cid : str or None
        Content-ID for the inline snapshot image (e.g., "snapshot"). If provided,
        the image is referenced as cid:snapshot inside the email.

    Returns
    -------
    str  – complete HTML document ready for EmailMessage.
    """
    et = str(event_data.get("event_type", "unknown"))
    style = _get_event_style(et)

    camera = event_data.get("camera_name", "Unknown Camera")
    confidence = event_data.get("confidence", 0)
    timestamp = event_data.get("timestamp", "")
    if isinstance(timestamp, datetime):
        timestamp = timestamp.strftime("%B %d, %Y  %I:%M:%S %p")

    detected_objects = event_data.get("detected_objects", [])
    ai_summary = event_data.get("ai_summary", "")
    face_name = event_data.get("face_name", "")
    bbox = event_data.get("bounding_box", {})

    # Build label
    label = style["label"]
    if face_name:
        label = f"Known Face — {face_name}" if "known" in et else f"Unknown Face Detected"

    # Snapshot image HTML
    if snapshot_cid:
        snapshot_html = (
            f'<img src="cid:{snapshot_cid}" alt="Event Snapshot" '
            f'style="width:100%;max-width:600px;border-radius:8px;display:block;" />'
        )
    else:
        snapshot_html = (
            '<div style="background:#1F2937;border-radius:8px;padding:40px;text-align:center;'
            'color:#6B7280;font-size:14px;">No snapshot available</div>'
        )

    # Bounding box info
    bbox_html = ""
    if bbox:
        x = bbox.get("x", 0)
        y = bbox.get("y", 0)
        w = bbox.get("width", bbox.get("w", 0))
        h = bbox.get("height", bbox.get("h", 0))
        bbox_html = f"""
                <tr>
                    <td class="detail-label" style="padding:10px 12px 4px;color:#9CA3AF;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:none;">Bounding Box</td>
                </tr>
                <tr>
                    <td class="detail-value" style="padding:0 12px 10px;color:#E5E7EB;font-size:14px;border-bottom:1px solid #374151;">{x}, {y} ({w}&times;{h})</td>
                </tr>"""

    # Face info row
    face_html = ""
    if face_name:
        face_html = f"""
                <tr>
                    <td class="detail-label" style="padding:10px 12px 4px;color:#9CA3AF;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:none;">Identified As</td>
                </tr>
                <tr>
                    <td class="detail-value" style="padding:0 12px 10px;color:#10B981;font-size:14px;font-weight:700;border-bottom:1px solid #374151;">{face_name}</td>
                </tr>"""

    return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
@media only screen and (max-width: 620px) {{
    .outer-table {{ width: 100% !important; }}
    .main-card {{ width: 100% !important; border-radius: 0 !important; }}
    .header-td {{ padding: 16px !important; }}
    .header-label {{ font-size: 15px !important; }}
    .conf-badge {{ display: block !important; margin-top: 8px !important; }}
    .snap-td {{ padding: 12px 12px 6px !important; }}
    .detail-td {{ padding: 8px 12px !important; }}
    .detail-table {{ width: 100% !important; }}
    .detail-label {{ display: block !important; padding: 8px 12px 2px !important; font-size: 11px !important; border-bottom: none !important; }}
    .detail-value {{ display: block !important; padding: 2px 12px 10px !important; border-bottom: 1px solid #374151 !important; }}
    .ai-td {{ padding: 4px 12px 12px !important; }}
    .footer-td {{ padding: 12px !important; }}
}}
</style>
</head>
<body style="margin:0;padding:0;background:#0F172A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" class="outer-table" width="100%" cellpadding="0" cellspacing="0" style="background:#0F172A;">
<tr><td align="center" style="padding:24px 12px;">

<!-- Main card -->
<table role="presentation" class="main-card" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111827;border-radius:12px;overflow:hidden;border:1px solid #1F2937;">

    <!-- Header banner -->
    <tr>
        <td class="header-td" style="background:{style['bg']};padding:20px 24px;">
            <div style="font-size:0;">
                <span style="font-size:20px;vertical-align:middle;">&#x1F6A8;</span>
                <span class="header-label" style="color:#FFFFFF;font-size:17px;font-weight:700;vertical-align:middle;margin-left:6px;">
                    {label}
                </span>
            </div>
            <div class="conf-badge" style="margin-top:8px;">
                <span style="background:rgba(255,255,255,0.2);color:#fff;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">
                    {_format_confidence(confidence)} conf
                </span>
            </div>
        </td>
    </tr>

    <!-- Snapshot -->
    <tr>
        <td class="snap-td" style="padding:16px 20px 8px;">
            {snapshot_html}
        </td>
    </tr>

    <!-- Event details -->
    <tr>
        <td class="detail-td" style="padding:12px 20px;">
            <table role="presentation" class="detail-table" width="100%" cellpadding="0" cellspacing="0" style="background:#1F2937;border-radius:8px;overflow:hidden;">
                <tr>
                    <td class="detail-label" style="padding:10px 12px 4px;color:#9CA3AF;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:none;">Event Type</td>
                </tr>
                <tr>
                    <td class="detail-value" style="padding:0 12px 10px;border-bottom:1px solid #374151;">
                        <span style="display:inline-block;background:{style['bg']};color:#fff;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;">{et}</span>
                    </td>
                </tr>
                <tr>
                    <td class="detail-label" style="padding:10px 12px 4px;color:#9CA3AF;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:none;">Camera</td>
                </tr>
                <tr>
                    <td class="detail-value" style="padding:0 12px 10px;color:#E5E7EB;font-size:14px;font-weight:600;border-bottom:1px solid #374151;">&#x1F4F9; {camera}</td>
                </tr>
                <tr>
                    <td class="detail-label" style="padding:10px 12px 4px;color:#9CA3AF;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:none;">Time</td>
                </tr>
                <tr>
                    <td class="detail-value" style="padding:0 12px 10px;color:#E5E7EB;font-size:14px;border-bottom:1px solid #374151;">&#x1F552; {timestamp}</td>
                </tr>
                <tr>
                    <td class="detail-label" style="padding:10px 12px 4px;color:#9CA3AF;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:none;">Confidence</td>
                </tr>
                <tr>
                    <td class="detail-value" style="padding:0 12px 10px;font-size:14px;border-bottom:1px solid #374151;">{_format_confidence(confidence)}</td>
                </tr>
                <tr>
                    <td class="detail-label" style="padding:10px 12px 4px;color:#9CA3AF;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:none;">Objects Detected</td>
                </tr>
                <tr>
                    <td class="detail-value" style="padding:4px 12px 10px;border-bottom:1px solid #374151;">{_format_objects(detected_objects)}</td>
                </tr>{bbox_html}{face_html}
            </table>
        </td>
    </tr>

    <!-- AI Analysis -->
    <tr>
        <td class="ai-td" style="padding:4px 20px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1F2937;border-radius:8px;overflow:hidden;">
                <tr>
                    <td style="padding:12px 12px 8px;">
                        <span style="color:#9CA3AF;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">
                            &#x1F9E0; AI Analysis
                        </span>
                    </td>
                </tr>
                <tr>
                    <td style="padding:4px 12px 14px;color:#D1D5DB;font-size:14px;line-height:1.6;">
                        {ai_summary if ai_summary else '<span style="color:#6B7280;">Analysis pending...</span>'}
                    </td>
                </tr>
            </table>
        </td>
    </tr>

    <!-- Footer -->
    <tr>
        <td class="footer-td" style="padding:16px 20px;border-top:1px solid #1F2937;text-align:center;">
            <span style="color:#6B7280;font-size:11px;">
                Sent by <strong style="color:#4F8EF7;">Vision Pro</strong> &middot; AI-Powered NVR System
            </span>
        </td>
    </tr>

</table>
<!-- End main card -->

</td></tr>
</table>
</body>
</html>"""


def render_daily_digest(events_summary: Dict[str, Any]) -> str:
    """
    Render a daily digest email summarizing all events.

    Parameters
    ----------
    events_summary : dict
        Keys: date (str), total_events (int), type_breakdown (dict),
              camera_breakdown (dict), top_events (list of event dicts)
    """
    date_str = events_summary.get("date", "Today")
    total = events_summary.get("total_events", 0)
    type_breakdown = events_summary.get("type_breakdown", {})
    camera_breakdown = events_summary.get("camera_breakdown", {})
    top_events = events_summary.get("top_events", [])

    # Build type breakdown rows
    type_rows = ""
    for etype, count in type_breakdown.items():
        style = _get_event_style(etype)
        type_rows += f"""
        <tr>
            <td style="padding:6px 12px;border-bottom:1px solid #374151;">
                <span style="background:{style['bg']};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;">{etype}</span>
            </td>
            <td style="padding:6px 12px;color:#E5E7EB;font-size:14px;font-weight:700;border-bottom:1px solid #374151;text-align:right;">{count}</td>
        </tr>"""

    # Build camera breakdown rows
    camera_rows = ""
    for cam, count in camera_breakdown.items():
        camera_rows += f"""
        <tr>
            <td style="padding:6px 12px;color:#D1D5DB;font-size:13px;border-bottom:1px solid #374151;">&#x1F4F9; {cam}</td>
            <td style="padding:6px 12px;color:#E5E7EB;font-size:14px;font-weight:700;border-bottom:1px solid #374151;text-align:right;">{count}</td>
        </tr>"""

    # Build top events rows
    top_events_html = ""
    for evt in top_events[:5]:
        ts = evt.get("timestamp", "")
        if isinstance(ts, datetime):
            ts = ts.strftime("%I:%M %p")
        style = _get_event_style(evt.get("event_type", ""))
        summary = evt.get("ai_summary", "Event detected")[:100]
        top_events_html += f"""
        <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #374151;">
                <span style="color:#9CA3AF;font-size:12px;">{ts}</span><br/>
                <span style="color:#E5E7EB;font-size:13px;">{summary}</span>
            </td>
            <td style="padding:8px 12px;border-bottom:1px solid #374151;text-align:right;">
                <span style="background:{style['bg']};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;">{evt.get('event_type','')}</span>
            </td>
        </tr>"""

    return f"""\
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0F172A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0F172A;">
<tr><td align="center" style="padding:24px 16px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#111827;border-radius:12px;overflow:hidden;border:1px solid #1F2937;">

    <!-- Header -->
    <tr>
        <td style="background:linear-gradient(135deg,#4F8EF7,#7C4DFF);padding:24px;text-align:center;">
            <div style="font-size:28px;">&#x1F4CA;</div>
            <div style="color:#fff;font-size:20px;font-weight:700;margin-top:8px;">Daily Security Digest</div>
            <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px;">{date_str}</div>
        </td>
    </tr>

    <!-- Total events card -->
    <tr>
        <td style="padding:20px;" align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" style="background:#1F2937;border-radius:8px;overflow:hidden;width:100%;">
                <tr>
                    <td style="padding:16px;text-align:center;">
                        <div style="color:#4F8EF7;font-size:36px;font-weight:800;">{total}</div>
                        <div style="color:#9CA3AF;font-size:13px;margin-top:4px;">Total Events Detected</div>
                    </td>
                </tr>
            </table>
        </td>
    </tr>

    <!-- Event type breakdown -->
    <tr>
        <td style="padding:0 20px 12px;">
            <div style="color:#9CA3AF;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">By Event Type</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1F2937;border-radius:8px;overflow:hidden;">
                {type_rows}
            </table>
        </td>
    </tr>

    <!-- Camera breakdown -->
    <tr>
        <td style="padding:0 20px 12px;">
            <div style="color:#9CA3AF;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">By Camera</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1F2937;border-radius:8px;overflow:hidden;">
                {camera_rows}
            </table>
        </td>
    </tr>

    <!-- Top events -->
    {"" if not top_events else f'''
    <tr>
        <td style="padding:0 20px 16px;">
            <div style="color:#9CA3AF;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Notable Events</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1F2937;border-radius:8px;overflow:hidden;">
                {top_events_html}
            </table>
        </td>
    </tr>
    '''}

    <!-- Footer -->
    <tr>
        <td style="padding:16px 20px;border-top:1px solid #1F2937;text-align:center;">
            <span style="color:#6B7280;font-size:11px;">
                Sent by <strong style="color:#4F8EF7;">Vision Pro</strong> &middot; AI-Powered NVR System
            </span>
        </td>
    </tr>

</table>

</td></tr>
</table>
</body>
</html>"""
