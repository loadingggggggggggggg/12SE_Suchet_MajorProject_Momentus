from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
import tkinter as tk

import customtkinter as ctk

try:
    from PIL import Image, ImageTk
except ImportError:
    Image = None
    ImageTk = None


@dataclass
class ThemeTokens:
    surface_bg: str = "#15181D"
    panel_bg: str = "#D8DADF"
    card_bg: str = "#F3F4F6"
    text_primary: str = "#17191F"
    text_muted: str = "#5E6470"
    card_shadow: str = "#F3F4F6"
    radius_md: int = 16
    radius_lg: int = 22
    font_title: tuple[str, int, str] = ("Segoe UI Semibold", 18, "normal")

    def scale_for_width(self, width: int) -> float:
        if width < 900:
            return 0.88
        if width < 1200:
            return 0.95
        return 1.0

    def font_scaled(self, font: tuple[str, int, str], scale: float) -> tuple[str, int, str]:
        family, size, weight = font
        return (family, max(10, int(size * scale)), weight)


@dataclass
class BentoCardProps:
    title: str
    icon: str | None = None
    span_cols: int = 1
    span_rows: int = 1
    hover_enabled: bool = False
    content_type: Literal["chart", "stats", "list", "form", "calendar"] = "stats"


class SectionHeader(ctk.CTkFrame):
    def __init__(self, master: Any, title: str, theme: ThemeTokens, scale: float = 1.0) -> None:
        super().__init__(master, fg_color="transparent")
        self.label = ctk.CTkLabel(
            self,
            text=title,
            text_color=theme.text_primary,
            font=theme.font_scaled(theme.font_title, scale),
        )
        self.label.pack(anchor="w")


class BentoCard(ctk.CTkFrame):
    def __init__(self, master: Any, props: BentoCardProps, theme: ThemeTokens):
        super().__init__(master, fg_color=theme.card_bg, corner_radius=theme.radius_md)
        self.props = props

        self.inner = ctk.CTkFrame(
            self,
            fg_color=theme.card_bg,
            corner_radius=theme.radius_md,
            border_width=0,
        )
        self.inner.pack(fill="both", expand=True, padx=0, pady=0)

        title_text = props.title if not props.icon else f"{props.icon}  {props.title}"
        self.title_label = ctk.CTkLabel(
            self.inner,
            text=title_text,
            text_color=theme.text_primary,
            font=("Segoe UI Semibold", 14),
        )
        self.title_label.pack(anchor="w", padx=12, pady=(12, 8))

        # Layout-only placeholder area.
        self.content = ctk.CTkFrame(self.inner, fg_color="transparent")
        self.content.pack(fill="both", expand=True, padx=12, pady=(0, 12))


class BentoGrid:
    def __init__(self, frame: ctk.CTkFrame):
        self.frame = frame
        self.cards: list[tuple[BentoCard, BentoCardProps]] = []
        self.current_cols = 3
        self._laid_out_once = False

    def add(self, card: BentoCard, props: BentoCardProps) -> None:
        self.cards.append((card, props))

    def relayout(self, width: int) -> None:
        if width < 900:
            cols = 1
            gap = 10
        elif width < 1200:
            cols = 2
            gap = 12
        else:
            cols = 3
            gap = 16

        if self._laid_out_once and cols == self.current_cols:
            return

        for card, _ in self.cards:
            card.grid_forget()

        for i in range(8):
            self.frame.grid_columnconfigure(i, weight=0)
        self.current_cols = cols

        for i in range(cols):
            self.frame.grid_columnconfigure(i, weight=1, uniform="cards")

        row = 0
        col = 0
        for card, props in self.cards:
            span = min(props.span_cols, cols)
            if col + span > cols:
                row += 1
                col = 0
            card.grid(row=row, column=col, columnspan=span, sticky="nsew", padx=gap // 2, pady=gap // 2)
            self.frame.grid_rowconfigure(row, weight=1)
            col += span
        self._laid_out_once = True


class BaseLayoutScreen:
    def __init__(self, title: str, cards: list[BentoCardProps]) -> None:
        self.title = title
        self.cards = cards
        self.root: ctk.CTkFrame | None = None
        self.grid: BentoGrid | None = None
        self._resize_after_id: str | None = None

    def build(self, parent: ctk.CTkFrame, theme: ThemeTokens) -> ctk.CTkFrame:
        self.root = ctk.CTkFrame(parent, fg_color="transparent")
        self.root.grid_rowconfigure(1, weight=1)
        self.root.grid_columnconfigure(0, weight=1)

        SectionHeader(self.root, self.title, theme).grid(row=0, column=0, sticky="w", padx=4, pady=(0, 8))
        canvas = ctk.CTkFrame(self.root, fg_color="transparent")
        canvas.grid(row=1, column=0, sticky="nsew")
        self.grid = BentoGrid(canvas)

        for props in self.cards:
            card = BentoCard(canvas, props, theme)
            self.grid.add(card, props)

        self.root.bind("<Configure>", self._on_resize)
        return self.root

    def _on_resize(self, event: Any) -> None:
        if not self.grid:
            return
        if self._resize_after_id is not None and self.root is not None:
            self.root.after_cancel(self._resize_after_id)
        if self.root is not None:
            width = event.width
            self._resize_after_id = self.root.after(40, lambda: self.grid.relayout(width))

    def on_show(self) -> None:
        return


class AppShell:
    def __init__(self) -> None:
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")
        self.theme = ThemeTokens()

        self.root = ctk.CTk()
        self.root.title("Momentus")
        self.root.geometry("1440x900")
        self.root.minsize(900, 700)
        self.root.configure(fg_color=self.theme.surface_bg)
        self.root.grid_columnconfigure(1, weight=1)
        self.root.grid_rowconfigure(0, weight=1)

        self.nav = ctk.CTkFrame(self.root, fg_color="#101318", width=220, corner_radius=0)
        self.nav.grid(row=0, column=0, sticky="nsw")
        self.nav.grid_propagate(False)

        self.content_panel = ctk.CTkFrame(
            self.root,
            fg_color=self.theme.panel_bg,
            corner_radius=self.theme.radius_lg,
            border_width=0,
        )
        self.content_panel.grid(row=0, column=1, sticky="nsew", padx=18, pady=18)
        self.content_panel.grid_rowconfigure(1, weight=1)
        self.content_panel.grid_columnconfigure(0, weight=1)

        self._build_nav()
        self._build_texture_layer()
        self._build_content_shell()
        self.screens: dict[str, BaseLayoutScreen] = {}
        self.screen_frames: dict[str, ctk.CTkFrame] = {}
        self.active_screen = "Dashboard"
        self._register_screens()
        self.show_screen("Dashboard")
        self.root.bind("<Configure>", self._on_resize)

    def _build_nav(self) -> None:
        avatar = ctk.CTkFrame(self.nav, fg_color="#2A313A", width=46, height=46, corner_radius=23)
        avatar.pack(anchor="w", padx=20, pady=(24, 12))
        ctk.CTkLabel(
            self.nav,
            text="Hey,\nMomentus User",
            justify="left",
            font=("Segoe UI Semibold", 16),
            text_color="#FFFFFF",
        ).pack(anchor="w", padx=20, pady=(0, 22))

        self.nav_buttons: dict[str, ctk.CTkButton] = {}
        for screen in ["Dashboard", "Training", "Nutrition", "Calendar"]:
            button = ctk.CTkButton(
                self.nav,
                text=screen,
                command=lambda s=screen: self.show_screen(s),
                fg_color="transparent",
                hover_color="#252A32",
                text_color="#CDD3DE",
                anchor="w",
                corner_radius=10,
                height=40,
            )
            button.pack(fill="x", padx=14, pady=3)
            self.nav_buttons[screen] = button

    def _build_content_shell(self) -> None:
        top = ctk.CTkFrame(self.foreground_layer, fg_color="transparent", height=58)
        top.grid(row=0, column=0, sticky="ew", padx=16, pady=(14, 0))
        top.grid_columnconfigure(0, weight=1)
        self.brand_title = ctk.CTkLabel(
            top,
            text="Momentus",
            text_color=self.theme.text_primary,
            font=("Segoe UI Semibold", 22),
        )
        self.brand_title.grid(row=0, column=0, sticky="w")
        self.brand_subtitle = ctk.CTkLabel(
            top,
            text="Layout Prototype",
            text_color=self.theme.text_muted,
            font=("Segoe UI", 12),
        )
        self.brand_subtitle.grid(row=1, column=0, sticky="w")

        # Main router area is created in _build_texture_layer after the background layer.

    def _build_texture_layer(self) -> None:
        # Dedicated image background that always spans the full right panel.
        self.texture_bg = tk.Label(self.content_panel, bd=0, highlightthickness=0, bg=self.theme.panel_bg)
        self.texture_bg.place(relx=0, rely=0, relwidth=1, relheight=1)
        self._texture_source: Image.Image | None = None
        self._texture_photo: ImageTk.PhotoImage | None = None

        texture_candidates = [
            Path(__file__).resolve().parent / "texture.jpeg",
            Path(__file__).resolve().parent / "texture.jpg",
            Path(__file__).resolve().parent / "texture.png",
            Path(__file__).resolve().parent / "assets" / "texture.jpeg",
            Path(__file__).resolve().parent / "assets" / "texture.jpg",
            Path(__file__).resolve().parent / "assets" / "texture.png",
        ]
        texture_path = next((p for p in texture_candidates if p.exists()), None)
        if texture_path and Image is not None and ImageTk is not None:
            self._texture_source = Image.open(texture_path).convert("RGB")
            self.content_panel.bind("<Configure>", self._on_texture_resize)
            self._on_texture_resize(None)
        else:
            self.texture_bg.configure(image="", bg=self.theme.panel_bg)

        # Foreground UI layer above texture.
        self.foreground_layer = ctk.CTkFrame(self.content_panel, fg_color="transparent")
        self.foreground_layer.place(relx=0, rely=0, relwidth=1, relheight=1)
        self.foreground_layer.grid_rowconfigure(1, weight=1)
        self.foreground_layer.grid_columnconfigure(0, weight=1)

        self.texture_bg.lower()
        self.foreground_layer.lift()

        self.router = ctk.CTkFrame(self.foreground_layer, fg_color="transparent")
        self.router.grid(row=1, column=0, sticky="nsew", padx=16, pady=16)
        self.router.grid_rowconfigure(0, weight=1)
        self.router.grid_columnconfigure(0, weight=1)

    def _on_texture_resize(self, _: Any) -> None:
        if self._texture_source is None or Image is None or ImageTk is None:
            return
        width = max(1, self.content_panel.winfo_width())
        height = max(1, self.content_panel.winfo_height())
        resample = getattr(Image, "Resampling", Image).LANCZOS
        resized = self._texture_source.resize((width, height), resample)
        self._texture_photo = ImageTk.PhotoImage(resized)
        self.texture_bg.configure(image=self._texture_photo)

    def _register_screens(self) -> None:
        self.screens = {
            "Dashboard": BaseLayoutScreen(
                "Dashboard",
                [
                    BentoCardProps(title="Training", icon="TRN"),
                    BentoCardProps(title="Nutrition", icon="NTR"),
                    BentoCardProps(title="Recovery", icon="RCV"),
                    BentoCardProps(title="Sleep", icon="SLP", span_cols=3),
                ],
            ),
            "Training": BaseLayoutScreen(
                "Training",
                [
                    BentoCardProps(title="Calendar", icon="CAL"),
                    BentoCardProps(title="Volume Distribution", icon="VOL"),
                    BentoCardProps(title="Trend", icon="TRD"),
                    BentoCardProps(title="Sessions", icon="LOG", span_cols=2),
                    BentoCardProps(title="Lifts", icon="LFT"),
                ],
            ),
            "Nutrition": BaseLayoutScreen(
                "Nutrition + Recovery",
                [
                    BentoCardProps(title="Macros", icon="MAC"),
                    BentoCardProps(title="Hydration", icon="HYD"),
                    BentoCardProps(title="Add Meal", icon="ADD"),
                    BentoCardProps(title="Log", icon="LOG", span_cols=2),
                    BentoCardProps(title="Details", icon="DTL"),
                ],
            ),
            "Calendar": BaseLayoutScreen(
                "Calendar",
                [
                    BentoCardProps(title="Date Range", icon="DTE", span_cols=2),
                    BentoCardProps(title="Filters", icon="FIL"),
                    BentoCardProps(title="Preview", icon="PRV", span_cols=3),
                ],
            ),
        }

        for name, screen in self.screens.items():
            frame = screen.build(self.router, self.theme)
            frame.grid(row=0, column=0, sticky="nsew")
            self.screen_frames[name] = frame

    def show_screen(self, name: str) -> None:
        if name not in self.screens:
            return
        self.active_screen = name
        for screen_name, frame in self.screen_frames.items():
            frame.grid_remove()
            btn = self.nav_buttons.get(screen_name)
            if btn:
                btn.configure(fg_color="transparent", text_color="#CDD3DE")
        self.screen_frames[name].grid()
        self.screens[name].on_show()
        active_btn = self.nav_buttons.get(name)
        if active_btn:
            active_btn.configure(fg_color="#2A3039", text_color="#FFFFFF")

    def _on_resize(self, event: Any) -> None:
        if event.widget is not self.root:
            return
        scale = self.theme.scale_for_width(event.width)
        self.brand_title.configure(font=self.theme.font_scaled(("Segoe UI Semibold", 22, "normal"), scale))
        self.brand_subtitle.configure(font=self.theme.font_scaled(("Segoe UI", 12, "normal"), scale))

    def run(self) -> None:
        self.root.mainloop()


def main() -> None:
    app = AppShell()
    app.run()


if __name__ == "__main__":
    main()