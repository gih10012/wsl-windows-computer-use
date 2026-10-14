using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

internal static class VerificationForm
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        var form = new Form {
            Text = "Computer Use verification", ClientSize = new Size(520, 300),
            StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false
        };
        var label = new Label {
            Text = "Enter the verification text, then click Verify.",
            Location = new Point(24, 24), Size = new Size(470, 28)
        };
        var field = new TextBox {
            Name = "VerificationText", AccessibleName = "Verification text",
            Location = new Point(24, 65), Size = new Size(470, 28)
        };
        var button = new Button {
            Text = "Verify", Name = "VerifyButton", AccessibleName = "Verify",
            Location = new Point(24, 112), Size = new Size(120, 36)
        };
        var result = new Label {
            Text = "Waiting", Name = "VerificationResult", AccessibleName = "Verification result",
            Location = new Point(24, 248), Size = new Size(470, 35)
        };
        var dragSurface = new Panel {
            Name = "DragSurface", AccessibleName = "Drag test surface",
            Location = new Point(24, 158), Size = new Size(470, 70),
            BackColor = Color.LightSteelBlue
        };
        var dragHint = new Label {
            Text = "Drag from left to right here", Location = new Point(10, 22),
            Size = new Size(430, 30), BackColor = Color.Transparent
        };
        dragSurface.Controls.Add(dragHint);
        int dragStartX = -1;
        dragSurface.MouseDown += delegate(object sender, MouseEventArgs e) {
            if (e.Button == MouseButtons.Left) dragStartX = e.X;
        };
        dragSurface.MouseUp += delegate(object sender, MouseEventArgs e) {
            if (dragStartX < 0) return;
            int distance = e.X - dragStartX;
            var output = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "artifacts", "drag-result.txt");
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            string status = distance >= 100 ? "DRAG PASS" : "DRAG FAIL";
            File.WriteAllText(output, status + ": dx=" + distance);
            result.Text = status + ": dx=" + distance;
            dragStartX = -1;
        };
        button.Click += delegate {
            result.Text = field.Text == "WSL Windows Computer Use OK" ? "PASS: keyboard and button click" : "FAIL: unexpected text";
            var output = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "artifacts", "verification-result.txt");
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            File.WriteAllText(output, result.Text + Environment.NewLine + field.Text);
        };
        form.Controls.AddRange(new Control[] { label, field, button, dragSurface, result });
        form.Shown += delegate { field.Focus(); };
        Application.Run(form);
    }
}
