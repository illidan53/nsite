# 入库的第三方数据

- `koppen_geiger_1991_2020_0p1.tif`、`koppen_legend.txt`：柯本-盖格气候分类图（1991–2020，0.1°），CC BY 4.0。
  `npm run data` 会把它降采样成 0.25° 网格（`public/data/koppen.bin`），供信息表里的“气候”一项使用。

  Beck, H. E., T. R. McVicar, N. Vergopolan, A. Berg, N. J. Lutsko, A. Dufour, Z. Zeng, X. Jiang,
  A. I. J. M. van Dijk, and D. G. Miralles. High-resolution (1 km) Köppen-Geiger maps for 1901–2099
  based on constrained CMIP6 projections. *Scientific Data* 10, 724 (2023).
  https://doi.org/10.1038/s41597-023-02549-6 · 数据：https://figshare.com/articles/dataset/21789074
