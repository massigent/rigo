// Command icon generates the Rigo application icon from geometry only.
//
// The logo is an original drawing (no third-party artwork): a rounded-square
// tile holding three text lines — the middle one shorter, centered and
// accented — which is the product's idea: the line you write on stays in the
// middle of the screen.
//
//	go run ./tools/icon            # writes web/static/img + Rigo.AppDir/rigo.png
package main

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
)

const size = 1024
const ss = 4 // supersampling factor for anti-aliasing

var (
	ink    = color.RGBA{0x15, 0x18, 0x1c, 0xff} // tile
	paper  = color.RGBA{0xe8, 0xe4, 0xda, 0xff} // dim lines
	accent = color.RGBA{0x4c, 0xb1, 0xff, 0xff} // the active line
)

// roundedRect reports whether (x, y) is inside a rounded rectangle.
func roundedRect(x, y, x0, y0, x1, y1, r float64) bool {
	if x < x0 || x > x1 || y < y0 || y > y1 {
		return false
	}
	cx := math.Min(math.Max(x, x0+r), x1-r)
	cy := math.Min(math.Max(y, y0+r), y1-r)
	dx, dy := x-cx, y-cy
	return dx*dx+dy*dy <= r*r
}

// render draws the icon at `n` pixels through supersampling.
func render(n int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, n, n))
	scale := float64(n) / size
	bars := []struct {
		x0, y0, x1, y1 float64
		c              color.RGBA
	}{
		// top and bottom lines: full width, dim
		{210, 340, 814, 404, paper},
		{210, 620, 814, 684, paper},
		// the middle line: shorter, exactly centered, accented
		{322, 480, 702, 544, accent},
	}
	for py := 0; py < n; py++ {
		for px := 0; px < n; px++ {
			var ar, ag, ab, aa float64
			// supersample the tile and the bars
			for sy := 0; sy < ss; sy++ {
				for sx := 0; sx < ss; sx++ {
					x := (float64(px) + (float64(sx)+0.5)/ss) / scale
					y := (float64(py) + (float64(sy)+0.5)/ss) / scale
					var c color.RGBA
					var covered bool
					if roundedRect(x, y, 0, 0, size, size, 190) {
						c, covered = ink, true
					}
					for _, b := range bars {
						if roundedRect(x, y, b.x0, b.y0, b.x1, b.y1, (b.y1-b.y0)/2) {
							c, covered = b.c, true
							break
						}
					}
					if covered {
						ar += float64(c.R)
						ag += float64(c.G)
						ab += float64(c.B)
						aa += 255
					}
				}
			}
			total := float64(ss * ss)
			if aa > 0 {
				img.SetRGBA(px, py, color.RGBA{
					uint8(ar / (aa / 255)),
					uint8(ag / (aa / 255)),
					uint8(ab / (aa / 255)),
					uint8(aa / total),
				})
			}
		}
	}
	return img
}

// svg is the same geometry as a vector source (favicon and documentation).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Rigo">
  <rect width="1024" height="1024" rx="190" fill="#15181c"/>
  <rect x="210" y="340" width="604" height="64" rx="32" fill="#e8e4da"/>
  <rect x="322" y="480" width="380" height="64" rx="32" fill="#4cb1ff"/>
  <rect x="210" y="620" width="604" height="64" rx="32" fill="#e8e4da"/>
</svg>
`

func main() {
	imgDir := filepath.Join("web", "static", "img")
	if err := os.MkdirAll(imgDir, 0o755); err != nil {
		fail(err)
	}
	if err := os.WriteFile(filepath.Join(imgDir, "rigo.svg"), []byte(svg), 0o644); err != nil {
		fail(err)
	}
	// The packaging icon (desktop file, deb/rpm, AppImage, Windows, macOS).
	sizes := []int{1024, 512, 256, 128, 64, 48, 32, 16}
	iconsDir := filepath.Join("icons")
	if err := os.MkdirAll(iconsDir, 0o755); err != nil {
		fail(err)
	}
	for _, n := range sizes {
		path := filepath.Join(iconsDir, fmt.Sprintf("rigo-%d.png", n))
		writePNG(path, render(n))
		if n == 256 {
			writePNG(filepath.Join("Rigo.AppDir", "rigo.png"), render(n))
			writePNG(filepath.Join("Rigo.AppDir", ".DirIcon"), render(n))
			writePNG(filepath.Join(iconsDir, "rigo.png"), render(n))
		}
	}
	fmt.Println("icons written: rigo.svg, icons/rigo-*.png, Rigo.AppDir/rigo.png")
}

func writePNG(path string, img *image.RGBA) {
	f, err := os.Create(path)
	if err != nil {
		fail(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		fail(err)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "icon:", err)
	os.Exit(1)
}
