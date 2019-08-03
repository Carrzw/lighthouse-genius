# lighthouse-genius
This is a tool helping collect website performance data under [lighthouse](https://github.com/GoogleChrome/lighthouse) monitoring.
To accelerate the collecting process, this is a multithread process which could handles multiple task workers at the same time.

Also to make this tool convenient enough for non-developers to use, wrapping it as an executable that can be run even on devices without Node.js installed by utilizing [pkg](https://github.com/zeit/pkg).

# Usage

## Executable
* [Download](https://drive.google.com/file/d/1Blzy00vEmMLzFQbwdCgyl4-IsHzDdU0w/view?usp=sharing) and unzip the package.
* Prepare an input file using this [template](https://drive.google.com/open?id=1qCeJ2teMxKhzqaSzC_PpBWKCQVq9QcCnXE7EAZ3-gpo) and named `input.csv`, put it under the `lighthouse-genius` folder.
* Double click the `exe.sh` could start auditing all the URLs provided in your input file.
* The result report would be generated in the output folder with task starting time as file name, don't worry that the report would be overrided.

**note**: this executable only works in Mac OS environment now.

## Developer

`node bin.js assets/input.csv` 