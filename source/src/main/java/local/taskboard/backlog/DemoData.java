package local.taskboard.backlog;

import java.util.List;

/** Task mẫu dùng khi chưa cấu hình Backlog, để thử giao diện. */
final class DemoData {
    private DemoData() {
    }

    static List<BacklogIssue> issues() {
        return List.of(
                new BacklogIssue("DEMO-101", "Thêm API xuất báo cáo doanh thu ra CSV",
                        "Người dùng cần nút xuất CSV trên màn hình báo cáo doanh thu.\n\n"
                                + "- Cột: ngày, chi nhánh, doanh thu, số đơn\n- Lọc theo khoảng ngày như màn hình hiện tại",
                        "Open", "Normal", "Task", "Demo", "2026-10-18T09:12:00Z", ""),
                new BacklogIssue("DEMO-102", "Sửa lỗi đăng nhập bị văng khi token hết hạn",
                        "Khi refresh token hết hạn, app trả 500 thay vì chuyển về trang đăng nhập.",
                        "Open", "High", "Bug", "Demo", "2026-10-18T08:40:00Z", ""),
                new BacklogIssue("DEMO-103", "Tối ưu truy vấn danh sách đơn hàng",
                        "Màn hình danh sách đơn hàng mất ~4s khi có trên 50k đơn. Cần xem lại query và index.",
                        "Open", "Normal", "Task", "Demo", "2026-10-17T15:05:00Z", ""),
                new BacklogIssue("DEMO-104", "Thêm validate số điện thoại khi đăng ký",
                        "Chỉ chấp nhận số điện thoại Việt Nam 10 số, bắt đầu bằng 0.",
                        "Open", "Low", "Task", "Demo", "2026-10-16T11:30:00Z", ""));
    }
}
