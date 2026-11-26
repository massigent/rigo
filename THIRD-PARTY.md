# Third-party components

Rigo itself is released under the MIT license (see `LICENSE`). The components
below are included in, or used to build, the distributed application. Nothing
else is bundled: there is no analytics, no remote code and no bundled browser.

## Fonts (SIL Open Font License 1.1)

All bundled typefaces are licensed under the SIL Open Font License, Version
1.1, which permits bundling and redistribution as part of a larger work. The
font files are unmodified. The full license text follows at the end of this
file and is also shipped at `web/static/fonts/licenses/`.

| Font | Files | Copyright |
| --- | --- | --- |
| IBM Plex Mono | `IBMPlexMono-Regular.woff2` | Copyright © 2017 IBM Corp. with Reserved Font Name "Plex" |
| IBM Plex Sans | `IBMPlexSans-Regular.woff2` | Copyright © 2017 IBM Corp. with Reserved Font Name "Plex" |
| IBM Plex Serif | `IBMPlexSerif-Regular.woff2` | Copyright © 2017 IBM Corp. with Reserved Font Name "Plex" |
| EB Garamond | `ebgaramond-400.woff2` | Copyright 2017 The EB Garamond Project Authors |
| Lora | `lora-400.woff2` | Copyright 2011 The Lora Project Authors, with Reserved Font Name "Lora" |

The IBM Plex files come from the official `@ibm/plex-*` packages
(https://github.com/IBM/plex).

## JavaScript

| Component | Version | License |
| --- | --- | --- |
| marked | 12.0.2 (`web/static/js/marked.min.js`) | MIT — Copyright (c) 2018+, MarkedJS; Copyright (c) 2011-2018, Christopher Jeffrey |

## Standards and toolchain

| Component | License |
| --- | --- |
| Markdown (original syntax and reference implementation by John Gruber) | BSD-3-Clause — Copyright © 2004, John Gruber |
| Go standard library (statically linked into the binaries) | BSD-3-Clause — Copyright (c) 2009 The Go Authors |

## Development only (not distributed)

| Component | License |
| --- | --- |
| jsdom | MIT |
| @sinonjs/fake-timers | BSD-3-Clause |

The Rust prototype on the `rust-native` branch uses permissively licensed
crates only: eframe/egui (MIT OR Apache-2.0), pulldown-cmark (MIT), rfd (MIT),
sha2 (MIT OR Apache-2.0), tempfile (MIT OR Apache-2.0), serde (MIT OR
Apache-2.0), tokio (MIT).

## Trademarks

Rigo is not affiliated with, endorsed by, or sponsored by any other editor.
Names of other products appear only in historical documents under
`REVIEW-*.md` and `AUDIT-IMPLEMENTATION.md`.

---

Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"

This Font Software is licensed under the SIL Open Font License, Version 1.1.

This license is copied below, and is also available with a FAQ at: http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
