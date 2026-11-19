# Prototype image sources

The product thumbnails use the following Unsplash photographs, downloaded and served locally. They illustrate fictional demo SKUs; they do not represent Docklane-owned product photography.

| Demo image         | Source                                                       |
| ------------------ | ------------------------------------------------------------ |
| Headphones         | https://images.unsplash.com/photo-1505740420928-5e560c06d30e |
| Everyday tote      | https://images.unsplash.com/photo-1544816155-12df9643f363    |
| Sneakers           | https://images.unsplash.com/photo-1542291026-7eec264c27ff    |
| Bottle             | https://images.unsplash.com/photo-1602143407151-7111542de6e8 |
| Watch              | https://images.unsplash.com/photo-1523275335684-37898b6baf30 |
| Sunglasses         | https://images.unsplash.com/photo-1511499767150-a48a237f0083 |
| Mug                | https://images.unsplash.com/photo-1514228742587-6b1558fcca3d |
| Weekender backpack | https://images.unsplash.com/photo-1553062407-98eeb64c6a62    |

The reproducible download script is `scripts/fetch-product-images.py`. Python is needed only to refresh these checked-in assets, not to run the application.

Geist Sans and Geist Mono are self-hosted through their Fontsource packages. Icons come from Phosphor. The Docklane mark is a simple original geometric letterform.

`apps/web/public/product-placeholder.svg` is an original, code-drawn parcel illustration added in Phase 3. It supplies missing-product imagery and the customer collection illustration. Product editors can also reference local images or HTTPS image URLs.
